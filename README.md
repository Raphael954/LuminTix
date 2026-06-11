# LuminTix

LuminTix is an entertainment discovery, USD card-payment, and digital-ticket platform built with Express, EJS, Neon Postgres, Ticketmaster Discovery, Paystack, and Brevo.

## What It Does

- Lists local and Ticketmaster-discovered events on internal LuminTix pages.
- Assigns Ticketmaster events a stable LuminTix tier and USD price for two UTC calendar days.
- Calculates every order server-side and redirects customers to Paystack USD card checkout.
- Verifies Paystack callbacks and signed webhooks before issuing tickets.
- Generates one QR-coded PDF per purchased quantity and packages them in a ZIP.
- Provides an immediate secure download and sends a recovery copy through Brevo.
- Lets public QR scans consume a ticket once; repeat scans show it as already used.
- Gives admins event, order, payment, email, ticket, and check-in visibility.

## Required Services

1. Create a Neon Postgres database and copy its connection string to `DATABASE_URL`.
2. Create a Ticketmaster developer application and copy its Discovery API consumer key to `TICKETMASTER_API_KEY`.
3. Enable USD card transactions on the Paystack account and copy the secret key to `PAYSTACK_SECRET_KEY`.
4. Register a verified, unmonitored no-reply sender in Brevo and configure `BREVO_API_KEY`, `BREVO_SENDER_NAME`, and `BREVO_SENDER_EMAIL`.
5. Enable Vercel's automatic System Environment Variables. Set `APP_URL` only when you want to override the detected deployment URL.

Paystack must support USD on the configured account. LuminTix never silently converts USD to another currency.
Brevo delivery uses its REST API, so an SMTP key is not required. Ticket emails omit `replyTo`, identify the mailbox as unmonitored, and should be sent from a mailbox configured to discard incoming replies.

## Setup

```powershell
npm.cmd install
npm.cmd run db:setup
npm.cmd test
npm.cmd start
```

Create a local ignored `.env` and supply the credentials before running checkout. Database setup applies unapplied migrations and normalizes local events to Standard, Standard Plus, Premium, and VIP.

Required production variables:

```env
NODE_ENV=production
# Optional explicit override. Leave unset on Vercel for automatic URL detection.
APP_URL=https://your-domain.example
DATABASE_URL=
SESSION_SECRET=
ADMIN_NAME=Site Admin
ADMIN_EMAIL=
ADMIN_PASSWORD=
TICKETMASTER_API_KEY=
PAYSTACK_SECRET_KEY=
BREVO_API_KEY=
BREVO_SENDER_NAME=LuminTix Tickets (No Reply)
BREVO_SENDER_EMAIL=
```

Set these separately in the Vercel project settings. Keep `.env` local and never upload it.

## Production Configuration

Production requires `DATABASE_URL`, `SESSION_SECRET`, `TICKETMASTER_API_KEY`, `PAYSTACK_SECRET_KEY`, `BREVO_API_KEY`, `BREVO_SENDER_NAME`, `BREVO_SENDER_EMAIL`, and non-default admin credentials. It also requires either an HTTPS `APP_URL` override or Vercel's automatically exposed system URL variables.

Public links use this precedence:

1. Explicit `APP_URL`.
2. `VERCEL_PROJECT_PRODUCTION_URL` for production deployments.
3. `VERCEL_URL` for preview deployments.
4. Local `http://localhost:PORT` fallback.

Paystack callback URLs, Brevo ticket-download links, and ticket QR validation URLs all use this resolved public URL.

Configure the Paystack webhook URL as:

`https://your-domain.example/webhooks/paystack`

## Pricing and Cleanup

Ticketmaster prices are never used. Each discovered event receives one of:

- Standard: `$500`
- Standard Plus: `$1,000`
- Premium: `$1,500`
- VIP: `$2,000`

Assignments are authoritative in Neon. Expired assignments are rejected during lookup and an application scheduler removes them at `00:00 UTC`, protected by a Postgres advisory lock.

## Useful Commands

```powershell
npm.cmd run check
npm.cmd test
npm.cmd run dev
npm.cmd run db:migrate
npm.cmd run db:setup
```

`db:migrate` applies only unapplied migrations. `db:setup` also seeds and normalizes local application data.

`GET /healthz` reports application and database health.
