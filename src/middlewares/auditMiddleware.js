const { randomUUID } = require("crypto");

const { createAuditLog, sanitizeObject } = require("../services/auditService");

function inferResourceType(pathname = "") {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] !== "api") return "";
  return parts[1] || "";
}

function inferResourceId(req) {
  if (req.params?.id) return String(req.params.id);
  if (req.params?.movementId) return String(req.params.movementId);
  if (req.params?.orderId) return String(req.params.orderId);
  if (req.params?.productId) return String(req.params.productId);
  if (req.params?.clientId) return String(req.params.clientId);
  return "";
}

function auditMiddleware(req, res, next) {
  const requestId = randomUUID();
  const startedAt = Date.now();
  req.requestId = requestId;

  res.on("finish", async () => {
    const pathname = req.originalUrl.split("?")[0] || "";

    if (!pathname.startsWith("/api/")) return;
    if (pathname === "/api/health") return;
    if (pathname.startsWith("/api/notifications/stream")) return;
    if (pathname === "/api/auth/login" || pathname === "/auth/login") return;

    const resourceType = inferResourceType(pathname);
    const resourceId = inferResourceId(req);
    const localAudit = res.locals?.audit || {};

    const durationMs = Date.now() - startedAt;
    const action =
      localAudit.action ||
      `${req.method.toUpperCase()} ${resourceType || "api"}`
        .trim()
        .replace(/\s+/g, "_")
        .toUpperCase();

    const user = req.user || null;

    await createAuditLog({
      tenant: user?.tenant || null,
      user: user?._id || null,
      userEmail: user?.email || "",
      action,
      method: req.method,
      path: pathname,
      statusCode: res.statusCode,
      resourceType: localAudit.resourceType || resourceType,
      resourceId:
        localAudit.resourceId != null
          ? String(localAudit.resourceId)
          : resourceId,
      ip: req.ip || req.headers["x-forwarded-for"] || "",
      userAgent: req.headers["user-agent"] || "",
      requestId,
      metadata: {
        durationMs,
        params: sanitizeObject(req.params || {}),
        query: sanitizeObject(req.query || {}),
        body: sanitizeObject(req.body || {}),
        ...sanitizeObject(localAudit.metadata || {}),
      },
    });
  });

  next();
}

module.exports = auditMiddleware;
