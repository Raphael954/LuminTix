const isProduction = process.env.NODE_ENV === "production";

function readBool(name, fallback = false) {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
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
  requireEnv("WHATSAPP_PHONE");

  if (process.env.SESSION_SECRET.length < 32) {
    throw new Error("SESSION_SECRET must be at least 32 characters in production.");
  }

  if (process.env.ADMIN_PASSWORD === "admin123") {
    throw new Error("ADMIN_PASSWORD must be changed before production database setup.");
  }
}

export { isProduction, readBool, validateConfig };
