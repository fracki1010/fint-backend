const Tenant = require("../models/tenant.model");
const User = require("../models/user.model");
const { Product } = require("../models/product.model");
const Order = require("../models/order.model");
const { handleServerError } = require("../utils/http");
const {
  COMPLEMENTS,
  APP_BASE,
  deriveEnabledFeatures,
  deriveLimits,
  computeTotalPrice,
} = require("../config/complementConfig");

const serializeLimit = (value) => (value === Infinity ? -1 : value);

exports.getTenantPlan = async (req, res) => {
  try {
    const tenant = await Tenant.findById(req.user.tenant).lean();
    if (!tenant) {
      return res.status(404).json({ success: false, message: "Tenant no encontrado" });
    }

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const [totalUsers, totalProducts, ordersThisMonth] = await Promise.all([
      User.countDocuments({ tenant: tenant._id, isActive: true }),
      Product.countDocuments({ tenant: tenant._id }),
      Order.countDocuments({ tenant: tenant._id, createdAt: { $gte: startOfMonth } }),
    ]);

    await Tenant.findByIdAndUpdate(tenant._id, {
      $set: {
        "usage.currentUsers": totalUsers,
        "usage.currentProducts": totalProducts,
        "usage.ordersThisMonth": ordersThisMonth,
        "usage.lastCalculatedAt": new Date(),
      },
    });

    const limits = deriveLimits(tenant.complements);
    const enabledFeatures = deriveEnabledFeatures(tenant.complements);

    const usagePercentages = {
      users: limits.maxUsers === -1 || limits.maxUsers === Infinity ? 0 : Math.round((totalUsers / limits.maxUsers) * 100),
      products: limits.maxProducts === -1 || limits.maxProducts === Infinity ? 0 : Math.round((totalProducts / limits.maxProducts) * 100),
      orders: limits.maxOrdersPerMonth === -1 || limits.maxOrdersPerMonth === Infinity ? 0 : Math.round((ordersThisMonth / limits.maxOrdersPerMonth) * 100),
    };

    const availableComplements = Object.values(COMPLEMENTS).map((comp) => ({
      id: comp.id,
      name: comp.name,
      price: comp.price,
      features: comp.features || [],
      limits: comp.limits ? Object.fromEntries(
        Object.entries(comp.limits).map(([k, v]) => [k, serializeLimit(v)])
      ) : {},
      isActive: tenant.complements?.includes(comp.id) || false,
    }));

    return res.json({
      success: true,
      plan: {
        current: tenant.plan || "app_base",
        status: tenant.status,
        complements: tenant.complements || [],
        enabledFeatures,
        limits: {
          maxUsers: serializeLimit(limits.maxUsers),
          maxProducts: serializeLimit(limits.maxProducts),
          maxOrdersPerMonth: serializeLimit(limits.maxOrdersPerMonth),
        },
        usage: { currentUsers: totalUsers, currentProducts: totalProducts, ordersThisMonth },
        usagePercentages,
        billing: tenant.billing,
        trialEndsAt: tenant.trialEndsAt,
      },
      availableComplements,
    });
  } catch (error) {
    return handleServerError(res, error, "Error al obtener plan");
  }
};

exports.activateComplements = async (req, res) => {
  try {
    const { complements } = req.body;
    if (!Array.isArray(complements)) {
      return res.status(400).json({ success: false, message: "complements debe ser un array" });
    }

    // Validate all complement IDs
    for (const compId of complements) {
      if (!COMPLEMENTS[compId]) {
        return res.status(400).json({ success: false, message: `Complemento inválido: ${compId}` });
      }
    }

    const tenant = await Tenant.findById(req.user.tenant);
    if (!tenant) {
      return res.status(404).json({ success: false, message: "Tenant no encontrado" });
    }

    tenant.complements = complements;
    tenant.limits = deriveLimits(complements);
    tenant.enabledFeatures = deriveEnabledFeatures(complements);
    await tenant.save();

    const totalPrice = computeTotalPrice(complements);

    return res.json({
      success: true,
      message: "Complementos actualizados",
      plan: {
        current: tenant.plan,
        complements: tenant.complements,
        limits: {
          maxUsers: serializeLimit(tenant.limits.maxUsers),
          maxProducts: serializeLimit(tenant.limits.maxProducts),
          maxOrdersPerMonth: serializeLimit(tenant.limits.maxOrdersPerMonth),
        },
        enabledFeatures: tenant.enabledFeatures,
        totalPrice,
      },
    });
  } catch (error) {
    return handleServerError(res, error, "Error al activar complementos");
  }
};
