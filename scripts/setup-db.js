import "dotenv/config";

import bcrypt from "bcryptjs";
import { validateConfig } from "../src/config.js";
import { getPool } from "../src/db.js";
import seed from "../src/data/seed.js";
import { runMigrations } from "./migrations.js";

validateConfig();

async function upsertSequence(pool, tableName) {
  await pool.query(
    `SELECT setval(pg_get_serial_sequence($1, 'id'), COALESCE((SELECT MAX(id) FROM ${tableName}), 1), true)`,
    [tableName]
  );
}

async function main() {
  const pool = getPool();
  if (!pool) {
    throw new Error("DATABASE_URL is required. Add it to .env, then run npm run db:setup.");
  }

  await runMigrations(pool);

  const adminName = process.env.ADMIN_NAME || "Site Admin";
  const adminEmail = process.env.ADMIN_EMAIL || "admin@lumin.local";
  const adminPassword = process.env.ADMIN_PASSWORD || "admin123";
  const passwordHash = await bcrypt.hash(adminPassword, 12);

  await pool.query(
    `INSERT INTO admins (name, email, password_hash)
     VALUES ($1, $2, $3)
     ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, password_hash = EXCLUDED.password_hash`,
    [adminName, adminEmail, passwordHash]
  );

  for (const category of seed.categories) {
    await pool.query(
      `INSERT INTO categories (id, name, slug, description, accent_color, icon, image_url, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (slug) DO UPDATE
       SET name = EXCLUDED.name,
           description = EXCLUDED.description,
           accent_color = EXCLUDED.accent_color,
           icon = EXCLUDED.icon,
           image_url = EXCLUDED.image_url,
           sort_order = EXCLUDED.sort_order`,
      [
        category.id,
        category.name,
        category.slug,
        category.description,
        category.accent_color,
        category.icon,
        category.image_url,
        category.sort_order
      ]
    );
  }

  for (const venue of seed.venues) {
    await pool.query(
      `INSERT INTO venues (id, name, slug, city, state, country, address, description, image_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (slug) DO UPDATE
       SET name = EXCLUDED.name,
           city = EXCLUDED.city,
           state = EXCLUDED.state,
           country = EXCLUDED.country,
           address = EXCLUDED.address,
           description = EXCLUDED.description,
           image_url = EXCLUDED.image_url`,
      [
        venue.id,
        venue.name,
        venue.slug,
        venue.city,
        venue.state,
        venue.country,
        venue.address,
        venue.description,
        venue.image_url
      ]
    );
  }

  for (const event of seed.events) {
    await pool.query(
      `INSERT INTO events
        (id, title, slug, summary, description, category_id, venue_id, starts_at, ends_at, status,
         availability_status, image_url, hero_image_url, tags, is_featured, external_url, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
       ON CONFLICT (slug) DO UPDATE
       SET title = EXCLUDED.title,
           summary = EXCLUDED.summary,
           description = EXCLUDED.description,
           category_id = EXCLUDED.category_id,
           venue_id = EXCLUDED.venue_id,
           starts_at = EXCLUDED.starts_at,
           ends_at = EXCLUDED.ends_at,
           status = EXCLUDED.status,
           availability_status = EXCLUDED.availability_status,
           image_url = EXCLUDED.image_url,
           hero_image_url = EXCLUDED.hero_image_url,
           tags = EXCLUDED.tags,
           is_featured = EXCLUDED.is_featured,
           external_url = EXCLUDED.external_url,
           source = EXCLUDED.source,
           updated_at = NOW()`,
      [
        event.id,
        event.title,
        event.slug,
        event.summary,
        event.description,
        event.category_id,
        event.venue_id,
        event.starts_at,
        event.ends_at,
        event.status,
        event.availability_status,
        event.image_url,
        event.hero_image_url,
        event.tags,
        event.is_featured,
        event.external_url,
        event.source
      ]
    );
  }

  await pool.query("DELETE FROM ticket_options WHERE event_id = ANY($1::int[])", [
    seed.events.map((event) => event.id)
  ]);

  for (const ticket of seed.ticketOptions) {
    await pool.query(
      `INSERT INTO ticket_options
        (event_id, name, price_label, price_usd_cents, description, availability_label, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        ticket.event_id,
        ticket.name,
        ticket.price_label,
        ticket.price_usd_cents,
        ticket.description,
        ticket.availability_label,
        ticket.sort_order
      ]
    );
  }

  await upsertSequence(pool, "categories");
  await upsertSequence(pool, "venues");
  await upsertSequence(pool, "events");
  await upsertSequence(pool, "ticket_options");

  await pool.end();
  console.log("Database schema and seed data are ready.");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
