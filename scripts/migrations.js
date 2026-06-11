import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(scriptsDir, "..", "migrations");

function getMigrationFiles() {
  return fs
    .readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort();
}

async function bootstrapExistingMigrations(client) {
  const applied = await client.query("SELECT COUNT(*)::int AS count FROM schema_migrations");
  if (applied.rows[0].count > 0) return;

  const state = (
    await client.query(`
      SELECT
        to_regclass('public.admins') IS NOT NULL
          AND to_regclass('public.categories') IS NOT NULL
          AND to_regclass('public.venues') IS NOT NULL
          AND to_regclass('public.events') IS NOT NULL
          AND to_regclass('public.ticket_options') IS NOT NULL
          AND to_regclass('public.user_sessions') IS NOT NULL
          AND to_regclass('public.external_event_cache') IS NOT NULL AS has_initial_schema,
        to_regclass('public.orders') IS NOT NULL
          AND to_regclass('public.tickets') IS NOT NULL
          AND to_regclass('public.payment_webhook_events') IS NOT NULL
          AND to_regclass('public.email_deliveries') IS NOT NULL
          AND to_regclass('public.external_event_prices') IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'ticket_options'
              AND column_name = 'price_usd_cents'
          ) AS has_commerce_schema
    `)
  ).rows[0];

  if (state.has_initial_schema) {
    await client.query(
      "INSERT INTO schema_migrations (filename) VALUES ('001_init.sql') ON CONFLICT DO NOTHING"
    );
  }
  if (state.has_commerce_schema) {
    await client.query(
      "INSERT INTO schema_migrations (filename) VALUES ('002_ticketmaster_payments.sql') ON CONFLICT DO NOTHING"
    );
  }
}

async function runMigrations(pool, { log = console.log } = {}) {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('lumintix_schema_migrations'))");
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await bootstrapExistingMigrations(client);

    const applied = new Set(
      (await client.query("SELECT filename FROM schema_migrations")).rows.map((row) => row.filename)
    );
    const migrationFiles = getMigrationFiles();
    for (const migrationFile of migrationFiles) {
      if (applied.has(migrationFile)) {
        log(`Skipped ${migrationFile}; already applied.`);
        continue;
      }

      await client.query("BEGIN");
      try {
        await client.query(fs.readFileSync(path.join(migrationsDir, migrationFile), "utf8"));
        await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [migrationFile]);
        await client.query("COMMIT");
        log(`Applied ${migrationFile}.`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
    return migrationFiles;
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext('lumintix_schema_migrations'))");
    client.release();
  }
}

export { bootstrapExistingMigrations, getMigrationFiles, runMigrations };
