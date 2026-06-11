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

function requireEnv(name) {
  if (!process.env[name]) {
    throw new Error(`${name} is required when NODE_ENV=production.`);
  }
}

function validateConfig() {
  if (!isProduction) return;

  requireEnv("DATABASE_URL");
  requireEnv("SESSION_SECRET");
  requireEnv("APP_URL");
  requireEnv("TICKETMASTER_API_KEY");
  requireEnv("PAYSTACK_SECRET_KEY");
  requireEnv("RESEND_API_KEY");
  requireEnv("EMAIL_FROM");
  requireEnv("ADMIN_EMAIL");
  requireEnv("ADMIN_PASSWORD");

  if (process.env.SESSION_SECRET.length < 32) {
    throw new Error("SESSION_SECRET must be at least 32 characters in production.");
  }

  if (process.env.ADMIN_PASSWORD === "admin123") {
    throw new Error("ADMIN_PASSWORD must be changed before production database setup.");
  }

  if (!process.env.APP_URL.startsWith("https://")) {
    throw new Error("APP_URL must use HTTPS in production.");
  }
}

export { isProduction, readBool, readInt, validateConfig };
