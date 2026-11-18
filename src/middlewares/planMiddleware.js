const { sendError } = require("../utils/http");
const Tenant = require("../models/tenant.model");
const { tenantFeatures, tenantLimits } = require("../config/complementConfig");

function requireFeature(feature) {
  return async (req, res, next) => {
    try {
      const tenant = await Tenant.findById(req.user.tenant)
        .select("complements limitOverrides usage")
        .lean();

      if (!tenant) {
        return sendError(res, {
          status: 403,
          code: "TENANT_NOT_FOUND",
          message: "Tenant no encontrado",
        });
      }

      const features = tenantFeatures(tenant);

      if (!features.includes(feature)) {
        return sendError(res, {
          status: 403,
          code: "FEATURE_NOT_AVAILABLE",
          message: "Funcionalidad no disponible en tu plan actual",
        });
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}

function checkLimit(limitKey) {
  return async (req, res, next) => {
    try {
      const tenant = await Tenant.findById(req.user.tenant)
        .select("complements limitOverrides usage")
        .lean();

      if (!tenant) {
        return sendError(res, {
          status: 403,
          code: "TENANT_NOT_FOUND",
          message: "Tenant no encontrado",
        });
      }

      const max = tenantLimits(tenant)[limitKey];
      if (max === undefined || max <= 0) return next(); // 0 or -1 = unlimited

      const current = tenant.usage?.[limitKey] ?? 0;
      if (current >= max) {
        return sendError(res, {
          status: 403,
          code: "PLAN_LIMIT_EXCEEDED",
          message: "Límite del plan excedido",
        });
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = { requireFeature, checkLimit };
