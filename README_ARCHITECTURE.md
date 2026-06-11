# LuminTix Architecture

## Runtime

- `src/server.js` configures Express, security, sessions, integrations, routes, and schedulers.
- `src/store.js` owns local event/category/venue CRUD with a development memory fallback.
- `src/commerce-store.js` is the strict Neon-backed payment, pricing, order, ticket, webhook, and email data layer.
- `src/services/ticketmaster.js` maps Discovery API events, caches queries/details, retries transient failures, and applies authoritative prices.
- `src/services/paystack.js` initializes USD card-only checkout, verifies transactions, and validates webhook signatures.
- `src/services/tickets.js` renders branded QR tickets as PDFs and packages them into ZIP files.
- `src/services/email.js` delivers ticket ZIPs and secure links through Resend.
- `src/services/scheduler.js` runs startup/midnight price cleanup and the email retry queue.

## Purchase Flow

1. A customer opens a local or Ticketmaster event page and proceeds to checkout.
2. `POST /api/payments/initialize` resolves event and ticket pricing server-side, creates a pending order, and initializes Paystack.
3. Paystack redirects to the callback and separately sends a signed webhook.
4. Both paths verify reference, status, currency, and exact amount before calling the same idempotent fulfillment transaction.
5. Fulfillment marks the order paid, creates one unique ticket and validation token per quantity, and queues email delivery.
6. The success page exposes a tokenized ZIP download; the email queue sends the same ZIP through Resend.
7. A ticket QR opens the public check-in route, which atomically changes the ticket from `valid` to `used`.

## Data

Ordered migrations live in `migrations/`. Core commerce tables are `external_event_prices`, `external_event_cache`, `external_query_cache`, `external_api_state`, `orders`, `tickets`, `payment_webhook_events`, and `email_deliveries`.

Ticketmaster event snapshots and paid-order details are immutable inputs to generated tickets. Browser-submitted prices are never accepted.
