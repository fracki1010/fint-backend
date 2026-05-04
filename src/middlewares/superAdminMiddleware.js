const { sendError } = require("../utils/http");

/**
 * Middleware to ensure only SuperAdmins can access certain routes
 * This is stricter than requireRole - it explicitly checks isSuperAdmin flag
 */
const requireSuperAdmin = (req, res, next) => {
  if (!req.user) {
    return sendError(res, { 
      status: 401, 
      code: "AUTH_REQUIRED", 
      message: "No autenticado" 
    });
  }

  if (!req.user.isSuperAdmin) {
    return sendError(res, {
      status: 403,
      code: "SUPERADMIN_REQUIRED",
      message: "Acceso denegado. Se requieren privilegios de SuperAdmin.",
    });
  }

  return next();
};

/**
 * Middleware to log superadmin actions for audit trail
 * Should be used AFTER requireSuperAdmin on routes that modify data
 */
const auditSuperAdminAction = (action) => {
  return async (req, res, next) => {
    // Store original send to capture response
    const originalSend = res.send;
    
    res.send = function(data) {
      // Restore original send
      res.send = originalSend;
      
      // Only log successful actions (2xx status codes)
      if (res.statusCode >= 200 && res.statusCode < 300) {
        // We can't await here, but we can fire and forget
        // The AuditLog model will be available
        const AuditLog = require("../models/auditLog.model");
        
        AuditLog.create({
          action,
          admin: req.user._id,
          tenant: req.params.id || req.body.tenantId || req.tenant?._id,
          details: {
            body: req.body,
            params: req.params,
            query: req.query,
          },
          ip: req.ip || req.connection.remoteAddress,
          userAgent: req.headers["user-agent"],
          timestamp: new Date(),
        }).catch(err => {
          console.error("Failed to create audit log:", err);
        });
      }
      
      return res.send(data);
    };
    
    next();
  };
};

module.exports = { 
  requireSuperAdmin, 
  auditSuperAdminAction 
};
