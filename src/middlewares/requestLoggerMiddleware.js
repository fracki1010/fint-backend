const { logInfo, logWarn, logError } = require("../utils/logger");

function shouldSkipPath(pathname = "") {
  if (!pathname) return true;
  if (pathname === "/api/notifications/stream") return true;
  return false;
}

function requestLoggerMiddleware(req, res, next) {
  const startedAt = Date.now();

  res.on("finish", () => {
    const pathname = req.originalUrl.split("?")[0] || req.path || "";
    if (shouldSkipPath(pathname)) return;

    const durationMs = Date.now() - startedAt;
    const baseData = {
      requestId: req.requestId || res.locals?.requestId || "",
      method: req.method,
      path: pathname,
      statusCode: res.statusCode,
      durationMs,
      ip: req.ip || req.headers["x-forwarded-for"] || "",
      userId: req.user?._id ? String(req.user._id) : null,
      tenantId: req.user?.tenant ? String(req.user.tenant) : null,
    };

    if (res.statusCode >= 500) {
      logError("http_request", baseData);
      return;
    }

    if (res.statusCode >= 400) {
      logWarn("http_request", baseData);
      return;
    }

    logInfo("http_request", baseData);
  });

  next();
}

module.exports = requestLoggerMiddleware;
