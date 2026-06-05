import pg from "pg";

const { Pool } = pg;

let pool = null;

function shouldUseSsl(connectionString) {
  if (!connectionString) return false;
  return !connectionString.includes("localhost") && !connectionString.includes("127.0.0.1");
}

function getPool() {
  if (!process.env.DATABASE_URL) return null;

  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: shouldUseSsl(process.env.DATABASE_URL)
        ? { rejectUnauthorized: false }
        : false
    });
  }

  return pool;
}

async function query(sql, params = []) {
  const activePool = getPool();
  if (!activePool) {
    throw new Error("DATABASE_URL is not configured.");
  }

  return activePool.query(sql, params);
}

export {
  getPool,
  query
};

export const isConfigured = () => Boolean(process.env.DATABASE_URL);
