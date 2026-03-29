const { randomUUID } = require("crypto");

function normalizeRequestId(raw) {
  if (!raw || typeof raw !== "string") return null;
  const value = raw.trim();
  if (!value) return null;
  if (value.length > 128) return null;
  return value;
}

function requestContextMiddleware(req, res, next) {
  const incoming = normalizeRequestId(req.headers?.["x-request-id"]);
  const requestId = incoming || randomUUID();

  req.requestId = requestId;
  res.locals.requestId = requestId;
  res.setHeader("X-Request-Id", requestId);

  next();
}

module.exports = requestContextMiddleware;
