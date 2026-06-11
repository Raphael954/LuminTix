# LuminTix

LuminTix is an entertainment discovery, USD card-payment, and digital-ticket platform built with Express, EJS, Neon Postgres, Ticketmaster Discovery, Paystack, and Resend.

## What It Does

- Lists local and Ticketmaster-discovered events on internal LuminTix pages.
- Assigns Ticketmaster events a stable LuminTix tier and USD price for two UTC calendar days.
- Calculates every order server-side and redirects customers to Paystack USD card checkout.
- Verifies Paystack callbacks and signed webhooks before issuing tickets.
- Generates one QR-coded PDF per purchased quantity and packages them in a ZIP.
- Provides an immediate secure download and sends a recovery copy through Resend.
- Lets public QR scans consume a ticket once; repeat scans show it as already used.
- Gives admins event, order, payment, email, ticket, and check-in visibility.

## Required Services

1. Create a Neon Postgres database and copy its connection string to `DATABASE_URL`.
2. Create a Ticketmaster developer application and copy its Discovery API consumer key to `TICKETMASTER_API_KEY`.
3. Enable USD card transactions on the Paystack account and copy the secret key to `PAYSTACK_SECRET_KEY`.
4. Verify a Resend sending domain and configure `RESEND_API_KEY` and `EMAIL_FROM`.
5. Set `APP_URL` to the public HTTPS origin in production.

Paystack must support USD on the configured account. LuminTix never silently converts USD to another currency.

## Setup

```powershell
npm.cmd install
npm.cmd run db:setup
npm.cmd test
npm.cmd start
```

Copy `.env.example` values into `.env` and supply the credentials before running checkout. Database setup executes every SQL file in `migrations/` in filename order and normalizes local events to Standard, Standard Plus, Premium, and VIP.

## Production Configuration

Production requires `DATABASE_URL`, `SESSION_SECRET`, `APP_URL`, `TICKETMASTER_API_KEY`, `PAYSTACK_SECRET_KEY`, `RESEND_API_KEY`, `EMAIL_FROM`, and non-default admin credentials.

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
npm.cmd run db:setup
```

`GET /healthz` reports application and database health.
