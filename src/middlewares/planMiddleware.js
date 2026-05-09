const { sendError } = require("../utils/http");
const Tenant = require("../models/tenant.model");

const FEATURE_MATRIX = {
  essential: ["client_account", "supplier_account", "quotes"],
  business: [
    "financial_center",
    "recipes",
    "bill_of_materials",
    "supplier_account",
    "client_account",
    "team_management",
    "unlimited_products",
    "unlimited_orders",
    "banking",
    "quotes",
  ],
  enterprise: [
    "financial_center",
    "recipes",
    "bill_of_materials",
    "supplier_account",
    "client_account",
    "team_management",
    "unlimited_products",
    "unlimited_orders",
    "banking",
    "quotes",
    "advanced_reports",
    "api_access",
  ],
};

function requireFeature(feature) {
  return async (req, res, next) => {
    try {
      const tenant = await Tenant.findById(req.user.tenant)
        .select("plan enabledFeatures limits usage")
        .lean();

      if (!tenant) {
        return sendError(res, {
          status: 403,
          code: "TENANT_NOT_FOUND",
          message: "Tenant no encontrado",
        });
      }

      // enabledFeatures extends plan defaults (can only ADD features, never remove)
      const base = FEATURE_MATRIX[tenant.plan] || [];
      const extra = tenant.enabledFeatures || [];
      const features = [...new Set([...base, ...extra])];

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
        .select("usage limits")
        .lean();

      if (!tenant) {
        return sendError(res, {
          status: 403,
          code: "TENANT_NOT_FOUND",
          message: "Tenant no encontrado",
        });
      }

      const max = tenant.limits?.[limitKey];
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

module.exports = { requireFeature, checkLimit, FEATURE_MATRIX };
