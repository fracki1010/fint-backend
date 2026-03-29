const buckets = new Map();
const { sendError } = require("../utils/http");

const WINDOW_MS = Number(process.env.LOGIN_RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000;
const MAX_ATTEMPTS = Number(process.env.LOGIN_RATE_LIMIT_MAX_ATTEMPTS) || 10;

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }

  return req.ip || req.connection?.remoteAddress || "unknown";
}

function cleanupBucket(now) {
  for (const [key, entry] of buckets.entries()) {
    if (entry.expiresAt <= now) {
      buckets.delete(key);
    }
  }
}

function loginRateLimitMiddleware(req, res, next) {
  const now = Date.now();
  cleanupBucket(now);

  const ip = getClientIp(req);
  const email =
    typeof req.body?.email === "string"
      ? req.body.email.toLowerCase().trim()
      : "";
  const key = `${req.path}:${ip}:${email}`;
  const existing = buckets.get(key);

  if (!existing || existing.expiresAt <= now) {
    buckets.set(key, { count: 1, expiresAt: now + WINDOW_MS });
    return next();
  }

  if (existing.count >= MAX_ATTEMPTS) {
    const retryAfter = Math.ceil((existing.expiresAt - now) / 1000);
    res.setHeader("Retry-After", String(Math.max(retryAfter, 1)));
    return sendError(res, {
      status: 429,
      code: "RATE_LIMIT_EXCEEDED",
      message:
        "Demasiados intentos de autenticacion. Intenta nuevamente en unos minutos.",
    });
  }

  existing.count += 1;
  buckets.set(key, existing);
  return next();
}

module.exports = loginRateLimitMiddleware;
