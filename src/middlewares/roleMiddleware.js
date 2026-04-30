const { sendError } = require("../utils/http");

// Roles hierarchy: admin > contabilidad/deposito/ventas > lectura
const requireRole = (...roles) =>
  (req, res, next) => {
    if (!req.user) {
      return sendError(res, { status: 401, code: "AUTH_REQUIRED", message: "No autenticado" });
    }
    // superadmin bypasses all role checks
    if (req.user.isSuperAdmin) return next();
    // admin within tenant bypasses all role checks
    if (req.user.role === "admin") return next();

    if (!roles.includes(req.user.role)) {
      return sendError(res, {
        status: 403,
        code: "FORBIDDEN",
        message: "No tenés permiso para realizar esta acción",
      });
    }
    return next();
  };

// Shorthand: block write operations for non-admin roles
const readOnly = (req, res, next) => {
  if (!req.user) {
    return sendError(res, { status: 401, code: "AUTH_REQUIRED", message: "No autenticado" });
  }
  if (req.user.isSuperAdmin || req.user.role === "admin") return next();
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  return sendError(res, {
    status: 403,
    code: "FORBIDDEN",
    message: "No tenés permiso para realizar esta acción",
  });
};

module.exports = { requireRole, readOnly };
