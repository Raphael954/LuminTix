import "dotenv/config";

import { getPool } from "../src/db.js";
import { runMigrations } from "./migrations.js";

async function main() {
  const pool = getPool();
  if (!pool) {
    throw new Error("DATABASE_URL is required. Add it to .env, then run npm run db:migrate.");
  }

  await runMigrations(pool);
  await pool.end();
  console.log("Database migrations are ready.");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
