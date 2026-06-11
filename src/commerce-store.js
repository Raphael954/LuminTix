import crypto from "node:crypto";

import { getPool, isConfigured, query } from "./db.js";

function requireDatabase() {
  if (!isConfigured()) {
    throw new Error("DATABASE_URL is required for checkout, payments, and ticket issuance.");
  }
}

function randomToken(bytes = 24) {
  return crypto.randomBytes(bytes).toString("hex");
}

function buildCode(prefix) {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
}

export default function createCommerceStore() {
  async function cleanupExternalPrices() {
    requireDatabase();
    const client = await getPool().connect();
    try {
      const result = await client.query(
        `SELECT pg_try_advisory_lock(hashtext('lumintix_external_price_cleanup')) AS locked`
      );
      if (!result.rows[0].locked) return 0;
      return (await client.query("SELECT cleanup_external_event_prices() AS count")).rows[0].count;
    } finally {
      await client.query(`SELECT pg_advisory_unlock(hashtext('lumintix_external_price_cleanup'))`);
      client.release();
    }
  }

  async function assignExternalEventPrices(provider, eventIds) {
    requireDatabase();
    const ids = [...new Set(eventIds.map(String))];
    if (!ids.length) return [];

    await query(
      `DELETE FROM external_event_prices
       WHERE provider = $1
         AND provider_event_id = ANY($2::text[])
         AND stored_on <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date - 2`,
      [provider, ids]
    );

    const result = await query(
      `WITH requested AS MATERIALIZED (
         SELECT DISTINCT unnest($2::text[]) AS provider_event_id
       ),
       priced AS MATERIALIZED (
         SELECT provider_event_id, floor(random() * 4)::int AS tier_index
         FROM requested
       )
       INSERT INTO external_event_prices (provider, provider_event_id, price_usd, ticket_type, stored_on)
       SELECT $1, priced.provider_event_id, tier.price_usd, tier.ticket_type,
              (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date
       FROM priced
       JOIN (VALUES
         (0, 500, 'Standard'),
         (1, 1000, 'Standard Plus'),
         (2, 1500, 'Premium'),
         (3, 2000, 'VIP')
       ) tier(tier_index, price_usd, ticket_type) ON tier.tier_index = priced.tier_index
       ON CONFLICT (provider, provider_event_id) DO UPDATE
       SET price_usd = external_event_prices.price_usd,
           ticket_type = external_event_prices.ticket_type
       RETURNING provider, provider_event_id, price_usd, ticket_type, stored_on,
                 to_char(stored_on, 'DD/MM/YYYY') AS stored_on_display`,
      [provider, ids]
    );
    return result.rows;
  }

  async function getExternalEventCache(provider, eventId) {
    requireDatabase();
    return (
      await query(
        `SELECT payload, fresh_until > NOW() AS fresh, stale_until > NOW() AS stale
         FROM external_event_cache
         WHERE provider = $1 AND provider_event_id = $2 AND stale_until > NOW()`,
        [provider, String(eventId)]
      )
    ).rows[0] || null;
  }

  async function saveExternalEvents(provider, events, options) {
    requireDatabase();
    for (const event of events) {
      await query(
        `INSERT INTO external_event_cache
          (provider, provider_event_id, payload, fetched_at, fresh_until, stale_until)
         VALUES ($1, $2, $3, NOW(), NOW() + ($4 * INTERVAL '1 second'), NOW() + ($5 * INTERVAL '1 second'))
         ON CONFLICT (provider, provider_event_id) DO UPDATE
         SET payload = EXCLUDED.payload, fetched_at = NOW(),
             fresh_until = EXCLUDED.fresh_until, stale_until = EXCLUDED.stale_until`,
        [provider, String(event.external_event_id), event, options.freshSeconds, options.staleSeconds]
      );
    }
  }

  async function getExternalQueryCache(provider, cacheKey) {
    requireDatabase();
    return (
      await query(
        `SELECT payload, fresh_until > NOW() AS fresh, stale_until > NOW() AS stale
         FROM external_query_cache
         WHERE provider = $1 AND cache_key = $2 AND stale_until > NOW()`,
        [provider, cacheKey]
      )
    ).rows[0] || null;
  }

  async function saveExternalQueryCache(provider, cacheKey, queryData, payload, options) {
    requireDatabase();
    await query(
      `INSERT INTO external_query_cache
        (provider, cache_key, query_data, payload, fetched_at, fresh_until, stale_until)
       VALUES ($1, $2, $3, $4, NOW(), NOW() + ($5 * INTERVAL '1 second'), NOW() + ($6 * INTERVAL '1 second'))
       ON CONFLICT (provider, cache_key) DO UPDATE
       SET query_data = EXCLUDED.query_data, payload = EXCLUDED.payload, fetched_at = NOW(),
           fresh_until = EXCLUDED.fresh_until, stale_until = EXCLUDED.stale_until`,
      [provider, cacheKey, queryData, payload, options.freshSeconds, options.staleSeconds]
    );
  }

  async function getExternalApiState(provider) {
    requireDatabase();
    return (await query("SELECT * FROM external_api_state WHERE provider = $1", [provider])).rows[0] || null;
  }

  async function saveExternalApiState(provider, state) {
    requireDatabase();
    return (
      await query(
        `INSERT INTO external_api_state
          (provider, cooldown_until, rate_limit_limit, rate_limit_remaining, rate_limit_reset_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (provider) DO UPDATE SET
           cooldown_until = EXCLUDED.cooldown_until,
           rate_limit_limit = EXCLUDED.rate_limit_limit,
           rate_limit_remaining = EXCLUDED.rate_limit_remaining,
           rate_limit_reset_at = EXCLUDED.rate_limit_reset_at,
           updated_at = NOW()
         RETURNING *`,
        [provider, state.cooldown_until || null, state.limit || null, state.remaining || null, state.reset_at || null]
      )
    ).rows[0];
  }

  async function createOrder(payload) {
    requireDatabase();
    const orderCode = buildCode("LT");
    const reference = buildCode("PAY");
    const publicToken = randomToken();
    return (
      await query(
        `INSERT INTO orders
          (order_code, source, event_id, external_provider, external_event_id, event_snapshot,
           ticket_type, unit_price_usd_cents, quantity, amount_usd_cents, customer_name,
           customer_email, customer_phone, paystack_reference, public_token)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         RETURNING *`,
        [
          orderCode,
          payload.source,
          payload.event_id || null,
          payload.external_provider || null,
          payload.external_event_id || null,
          payload.event_snapshot,
          payload.ticket_type,
          payload.unit_price_usd_cents,
          payload.quantity,
          payload.unit_price_usd_cents * payload.quantity,
          payload.customer_name,
          payload.customer_email,
          payload.customer_phone,
          reference,
          publicToken
        ]
      )
    ).rows[0];
  }

  async function getOrderByReference(reference) {
    requireDatabase();
    return (await query("SELECT * FROM orders WHERE paystack_reference = $1", [reference])).rows[0] || null;
  }

  async function getOrderByPublicToken(token) {
    requireDatabase();
    return (await query("SELECT * FROM orders WHERE public_token = $1", [token])).rows[0] || null;
  }

  async function getOrderById(id) {
    requireDatabase();
    return (await query("SELECT * FROM orders WHERE id = $1", [id])).rows[0] || null;
  }

  async function listOrders(limit = 100) {
    requireDatabase();
    return (
      await query(
        `SELECT o.*, ed.status AS email_status, ed.attempts AS email_attempts,
                COUNT(t.id)::int AS ticket_count,
                COUNT(t.id) FILTER (WHERE t.status = 'used')::int AS used_ticket_count,
                COALESCE(
                  jsonb_agg(jsonb_build_object('ticket_code', t.ticket_code, 'status', t.status, 'used_at', t.used_at)
                    ORDER BY t.id) FILTER (WHERE t.id IS NOT NULL),
                  '[]'::jsonb
                ) AS tickets
         FROM orders o
         LEFT JOIN LATERAL (
           SELECT status, attempts
           FROM email_deliveries
           WHERE order_id = o.id
           ORDER BY (provider = 'brevo') DESC, updated_at DESC, id DESC
           LIMIT 1
         ) ed ON true
         LEFT JOIN tickets t ON t.order_id = o.id
         GROUP BY o.id, ed.status, ed.attempts
         ORDER BY o.created_at DESC LIMIT $1`,
        [limit]
      )
    ).rows;
  }

  async function markOrderFailed(reference) {
    requireDatabase();
    return (
      await query(
        `UPDATE orders SET status = 'failed', updated_at = NOW()
         WHERE paystack_reference = $1 AND status = 'pending' RETURNING *`,
        [reference]
      )
    ).rows[0] || null;
  }

  async function fulfillOrder(reference) {
    requireDatabase();
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const order = (await client.query("SELECT * FROM orders WHERE paystack_reference = $1 FOR UPDATE", [reference])).rows[0];
      if (!order) throw new Error("Order not found.");

      if (order.status !== "paid") {
        await client.query(
          `UPDATE orders SET status = 'paid', paid_at = NOW(), updated_at = NOW() WHERE id = $1`,
          [order.id]
        );
      }

      const existing = await client.query("SELECT * FROM tickets WHERE order_id = $1 ORDER BY id", [order.id]);
      if (!existing.rows.length) {
        for (let index = 0; index < order.quantity; index += 1) {
          await client.query(
            `INSERT INTO tickets (order_id, ticket_code, validation_token)
             VALUES ($1, $2, $3)`,
            [order.id, buildCode("TKT"), randomToken()]
          );
        }
      }

      await client.query(
        `INSERT INTO email_deliveries (order_id, provider) VALUES ($1, 'brevo')
         ON CONFLICT (order_id, provider) DO NOTHING`,
        [order.id]
      );
      await client.query("COMMIT");
      return getOrderWithTickets(order.id);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async function getOrderWithTickets(id) {
    requireDatabase();
    const [order, tickets] = await Promise.all([
      getOrderById(id),
      query("SELECT * FROM tickets WHERE order_id = $1 ORDER BY id", [id])
    ]);
    return order ? { ...order, tickets: tickets.rows } : null;
  }

  async function recordWebhook(eventKey, eventType, reference, payload) {
    requireDatabase();
    return (
      await query(
        `INSERT INTO payment_webhook_events (event_key, event_type, paystack_reference, payload)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (event_key) DO NOTHING
         RETURNING *`,
        [eventKey, eventType, reference || null, payload]
      )
    ).rows[0] || null;
  }

  async function consumeTicket(validationToken) {
    requireDatabase();
    const updated = (
      await query(
        `UPDATE tickets SET status = 'used', used_at = NOW()
         WHERE validation_token = $1 AND status = 'valid'
         RETURNING *`,
        [validationToken]
      )
    ).rows[0];
    const ticket = updated || (await query("SELECT * FROM tickets WHERE validation_token = $1", [validationToken])).rows[0];
    if (!ticket) return null;
    return { ...(await getOrderWithTickets(ticket.order_id)), scanned_ticket: ticket, newly_used: Boolean(updated) };
  }

  async function getPendingEmailDeliveries(limit = 10) {
    requireDatabase();
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      const claimed = await client.query(
        `SELECT ed.*
         FROM email_deliveries ed
         WHERE (
           ed.status IN ('pending','failed')
           OR (ed.status = 'processing' AND ed.updated_at < NOW() - INTERVAL '15 minutes')
         )
           AND ed.provider = 'brevo'
           AND ed.attempts < 5
         ORDER BY ed.updated_at ASC
         FOR UPDATE SKIP LOCKED
         LIMIT $1`,
        [limit]
      );
      if (claimed.rows.length) {
        await client.query(
          `UPDATE email_deliveries
           SET status = 'processing', attempts = attempts + 1, updated_at = NOW()
           WHERE id = ANY($1::bigint[])`,
          [claimed.rows.map((delivery) => delivery.id)]
        );
      }
      await client.query("COMMIT");
      return claimed.rows;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async function updateEmailDelivery(id, payload) {
    requireDatabase();
    return (
      await query(
        `UPDATE email_deliveries
         SET status = $2, provider_id = $3, last_error = $4,
             sent_at = CASE WHEN $2 = 'sent' THEN NOW() ELSE sent_at END,
             updated_at = NOW()
         WHERE id = $1 RETURNING *`,
        [id, payload.status, payload.provider_id || null, payload.last_error || null]
      )
    ).rows[0];
  }

  async function resetEmailDelivery(orderId) {
    requireDatabase();
    return (
      await query(
        `INSERT INTO email_deliveries (order_id, provider) VALUES ($1, 'brevo')
         ON CONFLICT (order_id, provider) DO UPDATE
         SET status = 'pending', attempts = 0, last_error = NULL, updated_at = NOW()
         RETURNING *`,
        [orderId]
      )
    ).rows[0];
  }

  async function getCommerceStats() {
    requireDatabase();
    const result = await query(
      `SELECT
         COUNT(*)::int AS orders,
         COUNT(*) FILTER (WHERE status = 'paid')::int AS paid_orders,
         COALESCE(SUM(amount_usd_cents) FILTER (WHERE status = 'paid'), 0)::bigint AS revenue_usd_cents
       FROM orders`
    );
    const tickets = await query(
      `SELECT COUNT(*)::int AS tickets,
              COUNT(*) FILTER (WHERE status = 'used')::int AS used_tickets
       FROM tickets`
    );
    return { ...result.rows[0], ...tickets.rows[0] };
  }

  return {
    assignExternalEventPrices,
    cleanupExternalPrices,
    consumeTicket,
    createOrder,
    fulfillOrder,
    getCommerceStats,
    getExternalApiState,
    getExternalEventCache,
    getExternalQueryCache,
    getOrderById,
    getOrderByPublicToken,
    getOrderByReference,
    getOrderWithTickets,
    getPendingEmailDeliveries,
    listOrders,
    markOrderFailed,
    recordWebhook,
    resetEmailDelivery,
    saveExternalApiState,
    saveExternalEvents,
    saveExternalQueryCache,
    updateEmailDelivery
  };
}
