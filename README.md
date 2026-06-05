# LuminTix

LuminTix is a modern entertainment discovery and WhatsApp booking platform for music, movies, sports, concerts, and nightlife.

## Features

- Public discovery pages, category browsing, search, event details, venue pages, and responsive Bootstrap UI.
- Request-only ticket flow that saves booking requests and opens WhatsApp with customer/event details pre-filled.
- Admin dashboard for events, categories, venues, ticket preferences, and request statuses.
- Neon Postgres support with seeded local fallback for development.
- Optional Ticketmaster Discovery API integration for partner event discovery.
- Production hardening: Helmet CSP, CSRF protection, rate limits, secure session options, health endpoint, and Postgres-backed sessions.

## Setup

1. Install dependencies:

```powershell
npm.cmd install
```

2. Fill in `.env`.

Required for production:

- `NODE_ENV=production`
- `DATABASE_URL`
- `SESSION_SECRET` with at least 32 characters
- `WHATSAPP_PHONE`
- `ADMIN_NAME`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`

3. Prepare the database:

```powershell
npm.cmd run db:setup
```

4. Start the app:

```powershell
npm.cmd start
```

The app runs on `http://localhost:3000` by default.

## Useful Commands

```powershell
npm.cmd run check
npm.cmd run dev
npm.cmd run db:setup
```

## Health Check

`GET /healthz` returns app and database status.

## Notes

- `.env` is intentionally ignored by Git.
- In development, the app can run without `DATABASE_URL` using seeded local data.
- In production, the app requires `DATABASE_URL`, `SESSION_SECRET`, and `WHATSAPP_PHONE`.
