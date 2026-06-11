ALTER TABLE ticket_options
  ADD COLUMN IF NOT EXISTS price_usd_cents BIGINT;

UPDATE ticket_options
SET price_usd_cents = CASE
  WHEN sort_order = 1 THEN 50000
  WHEN sort_order = 2 THEN 100000
  WHEN sort_order = 3 THEN 150000
  ELSE 200000
END
WHERE price_usd_cents IS NULL;

ALTER TABLE ticket_options
  ALTER COLUMN price_usd_cents SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'ticket_options'::regclass
      AND conname = 'ticket_options_positive_usd_price'
  ) THEN
    ALTER TABLE ticket_options
      ADD CONSTRAINT ticket_options_positive_usd_price CHECK (price_usd_cents > 0);
  END IF;
END
$$;

WITH targets AS MATERIALIZED (
  SELECT e.id
  FROM events e
  LEFT JOIN ticket_options t ON t.event_id = e.id
  WHERE e.source = 'local'
  GROUP BY e.id
  HAVING COUNT(t.id) <> 4
     OR COUNT(*) FILTER (
       WHERE (t.name, t.price_usd_cents) IN (
         ('Standard', 50000),
         ('Standard Plus', 100000),
         ('Premium', 150000),
         ('VIP', 200000)
       )
     ) <> 4
),
deleted AS (
  DELETE FROM ticket_options t
  USING targets
  WHERE t.event_id = targets.id
)
INSERT INTO ticket_options
  (event_id, name, price_label, price_usd_cents, description, availability_label, sort_order)
SELECT targets.id, tiers.name, tiers.price_label, tiers.price_usd_cents, tiers.description, 'Available', tiers.sort_order
FROM targets
CROSS JOIN (VALUES
  ('Standard', '$500', 50000::bigint, 'General admission access.', 1),
  ('Standard Plus', '$1,000', 100000::bigint, 'Enhanced placement and guest amenities.', 2),
  ('Premium', '$1,500', 150000::bigint, 'Premium viewing and hospitality access.', 3),
  ('VIP', '$2,000', 200000::bigint, 'Top-tier access and VIP hospitality.', 4)
) tiers(name, price_label, price_usd_cents, description, sort_order);

UPDATE events
SET availability_status = 'available'
WHERE availability_status = 'request_only';

ALTER TABLE external_event_cache
  ADD COLUMN IF NOT EXISTS fresh_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS stale_until TIMESTAMPTZ;

UPDATE external_event_cache
SET fresh_until = COALESCE(fresh_until, fetched_at + INTERVAL '1 hour'),
    stale_until = COALESCE(stale_until, fetched_at + INTERVAL '24 hours')
WHERE fresh_until IS NULL OR stale_until IS NULL;

ALTER TABLE external_event_cache
  ALTER COLUMN fresh_until SET NOT NULL,
  ALTER COLUMN stale_until SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_external_event_cache_expiration
  ON external_event_cache(provider, stale_until);

CREATE TABLE IF NOT EXISTS external_query_cache (
  provider TEXT NOT NULL,
  cache_key TEXT NOT NULL,
  query_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  payload JSONB NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  fresh_until TIMESTAMPTZ NOT NULL,
  stale_until TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (provider, cache_key)
);

CREATE INDEX IF NOT EXISTS idx_external_query_cache_expiration
  ON external_query_cache(provider, stale_until);

CREATE TABLE IF NOT EXISTS external_api_state (
  provider TEXT PRIMARY KEY,
  cooldown_until TIMESTAMPTZ,
  rate_limit_limit TEXT,
  rate_limit_remaining TEXT,
  rate_limit_reset_at TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS external_event_prices (
  provider TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  price_usd INTEGER NOT NULL,
  ticket_type TEXT,
  stored_on DATE NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date,
  PRIMARY KEY (provider, provider_event_id)
);

ALTER TABLE external_event_prices
  ADD COLUMN IF NOT EXISTS ticket_type TEXT;

DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  FOR constraint_name IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'external_event_prices'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%price_usd%'
  LOOP
    EXECUTE format('ALTER TABLE external_event_prices DROP CONSTRAINT %I', constraint_name);
  END LOOP;
END
$$;

ALTER TABLE external_event_prices
  ALTER COLUMN stored_on SET DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date;

UPDATE external_event_prices
SET ticket_type = CASE price_usd
  WHEN 500 THEN 'Standard'
  WHEN 1000 THEN 'Standard Plus'
  WHEN 1500 THEN 'Premium'
  WHEN 2000 THEN 'VIP'
END
WHERE ticket_type IS NULL;

ALTER TABLE external_event_prices
  ALTER COLUMN ticket_type SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'external_event_prices'::regclass
      AND conname = 'external_event_prices_allowed_price'
  ) THEN
    ALTER TABLE external_event_prices
      ADD CONSTRAINT external_event_prices_allowed_price
      CHECK (price_usd IN (500, 1000, 1500, 2000));
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_external_event_prices_stored_on
  ON external_event_prices(stored_on);

DROP TABLE IF EXISTS booking_requests;

CREATE TABLE IF NOT EXISTS orders (
  id BIGSERIAL PRIMARY KEY,
  order_code TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL CHECK (source IN ('local', 'ticketmaster')),
  event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
  external_provider TEXT,
  external_event_id TEXT,
  event_snapshot JSONB NOT NULL,
  ticket_type TEXT NOT NULL,
  unit_price_usd_cents BIGINT NOT NULL CHECK (unit_price_usd_cents > 0),
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 20),
  amount_usd_cents BIGINT NOT NULL CHECK (amount_usd_cents > 0),
  currency TEXT NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
  customer_name TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  paystack_reference TEXT NOT NULL UNIQUE,
  public_token TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed')),
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_status_created_at ON orders(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_external_event ON orders(external_provider, external_event_id);

CREATE TABLE IF NOT EXISTS tickets (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  ticket_code TEXT NOT NULL UNIQUE,
  validation_token TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'valid' CHECK (status IN ('valid', 'used')),
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tickets_order_id ON tickets(order_id);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);

CREATE TABLE IF NOT EXISTS payment_webhook_events (
  id BIGSERIAL PRIMARY KEY,
  event_key TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  paystack_reference TEXT,
  payload JSONB NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS email_deliveries (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'resend',
  provider_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'sent', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  sent_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(order_id, provider)
);

ALTER TABLE email_deliveries DROP CONSTRAINT IF EXISTS email_deliveries_status_check;
ALTER TABLE email_deliveries
  ADD CONSTRAINT email_deliveries_status_check CHECK (status IN ('pending', 'processing', 'sent', 'failed'));

CREATE INDEX IF NOT EXISTS idx_email_deliveries_retry
  ON email_deliveries(status, attempts, updated_at);

CREATE OR REPLACE FUNCTION cleanup_external_event_prices()
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM external_event_prices
  WHERE stored_on <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date - 2;

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;
