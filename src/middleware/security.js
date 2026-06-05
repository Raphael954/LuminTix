import crypto from "node:crypto";
import rateLimit from "express-rate-limit";

function ensureCsrfToken(req) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString("hex");
  }

  return req.session.csrfToken;
}

function csrfProtection(req, res, next) {
  if (req.path === "/healthz") {
    return next();
  }

  const token = ensureCsrfToken(req);
  res.locals.csrfToken = token;

  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
    return next();
  }

  const submittedToken = req.body?._csrf || req.get("x-csrf-token");
  const submitted = Buffer.from(String(submittedToken || ""));
  const expected = Buffer.from(token);

  if (submitted.length === expected.length && crypto.timingSafeEqual(submitted, expected)) {
    return next();
  }

  const error = new Error("Invalid or missing security token.");
  error.status = 403;
  return next(error);
}

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: "Too many sign-in attempts. Please try again shortly."
});

const bookingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: "Too many ticket requests. Please try again shortly."
});

export { bookingLimiter, csrfProtection, loginLimiter };
