const isProduction = process.env.NODE_ENV === "production";

function readBool(name, fallback = false) {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function readInt(name, fallback, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number.parseInt(process.env[name] || "", 10);
  const value = Number.isFinite(parsed) ? parsed : fallback;
  return Math.min(max, Math.max(min, value));
}

function normalizeAppUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
  return url.origin;
}

function getAppUrl({ port = Number(process.env.PORT || 3000) } = {}) {
  if (process.env.APP_URL) return normalizeAppUrl(process.env.APP_URL);

  if (process.env.VERCEL_ENV === "production" && process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return normalizeAppUrl(process.env.VERCEL_PROJECT_PRODUCTION_URL);
  }

  if (process.env.VERCEL_URL) return normalizeAppUrl(process.env.VERCEL_URL);
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return normalizeAppUrl(process.env.VERCEL_PROJECT_PRODUCTION_URL);

  return `http://localhost:${port}`;
}

function validateConfig({ production = isProduction } = {}) {
  if (!production) return;

  const required = ["DATABASE_URL", "SESSION_SECRET", "ADMIN_EMAIL", "ADMIN_PASSWORD"];
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length) {
    throw new Error(`Missing required production configuration: ${missing.join(", ")}.`);
  }

  if (process.env.SESSION_SECRET.length < 32) {
    throw new Error("SESSION_SECRET must be at least 32 characters in production.");
  }

  if (process.env.ADMIN_PASSWORD === "admin123") {
    throw new Error("ADMIN_PASSWORD must be changed before running in production.");
  }

  if (!getAppUrl().startsWith("https://")) {
    throw new Error("APP_URL or the resolved Vercel deployment URL must use HTTPS in production.");
  }
}

export { getAppUrl, isProduction, normalizeAppUrl, readBool, readInt, validateConfig };
