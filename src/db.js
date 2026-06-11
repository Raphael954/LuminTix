import pg from "pg";

const { Pool } = pg;

let pool = null;

function connectionStringForPool(connectionString) {
  if (!connectionString || connectionString.includes("localhost") || connectionString.includes("127.0.0.1")) {
    return connectionString;
  }
  const url = new URL(connectionString);
  if (!url.searchParams.get("sslmode") || ["prefer", "require", "verify-ca"].includes(url.searchParams.get("sslmode"))) {
    url.searchParams.set("sslmode", "verify-full");
  }
  return url.toString();
}

function getPool() {
  if (!process.env.DATABASE_URL) return null;

  if (!pool) {
    pool = new Pool({
      connectionString: connectionStringForPool(process.env.DATABASE_URL)
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
  connectionStringForPool,
  getPool,
  query
};

export const isConfigured = () => Boolean(process.env.DATABASE_URL);
