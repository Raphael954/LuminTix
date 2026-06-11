INSERT INTO email_deliveries
  (order_id, provider, provider_id, status, attempts, last_error, sent_at, updated_at)
SELECT
  order_id, 'brevo', provider_id, status, attempts, last_error, sent_at, updated_at
FROM email_deliveries
WHERE provider = 'resend'
  AND status <> 'sent'
ON CONFLICT (order_id, provider) DO UPDATE
SET provider_id = COALESCE(email_deliveries.provider_id, EXCLUDED.provider_id),
    status = CASE
      WHEN email_deliveries.status = 'sent' THEN email_deliveries.status
      ELSE EXCLUDED.status
    END,
    attempts = GREATEST(email_deliveries.attempts, EXCLUDED.attempts),
    last_error = COALESCE(email_deliveries.last_error, EXCLUDED.last_error),
    sent_at = COALESCE(email_deliveries.sent_at, EXCLUDED.sent_at),
    updated_at = GREATEST(email_deliveries.updated_at, EXCLUDED.updated_at);

DELETE FROM email_deliveries
WHERE provider = 'resend'
  AND status <> 'sent';

ALTER TABLE email_deliveries
  ALTER COLUMN provider SET DEFAULT 'brevo';
