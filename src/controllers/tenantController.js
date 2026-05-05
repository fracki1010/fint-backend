const Tenant = require("../models/tenant.model");
const User = require("../models/user.model");
const { Product } = require("../models/product.model");
const Order = require("../models/order.model");
const { handleServerError } = require("../utils/http");

const PLAN_CONFIGS = {
  essential: {
    maxUsers: 3,
    maxProducts: 200,
    maxOrdersPerMonth: 500,
    features: [],
    price: 2,
  },
  business: {
    maxUsers: 10,
    maxProducts: Infinity,
    maxOrdersPerMonth: Infinity,
    features: ["financial_center", "recipes"],
    price: 3,
  },
  enterprise: {
    maxUsers: Infinity,
    maxProducts: Infinity,
    maxOrdersPerMonth: Infinity,
    features: ["financial_center", "recipes", "advanced_reports", "api_access"],
    price: 8,
  },
};

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

    const planConfig = PLAN_CONFIGS[tenant.plan] || PLAN_CONFIGS.essential;
    const usagePercentages = {
      users: planConfig.maxUsers === Infinity ? 0 : Math.round((totalUsers / planConfig.maxUsers) * 100),
      products: planConfig.maxProducts === Infinity ? 0 : Math.round((totalProducts / planConfig.maxProducts) * 100),
      orders: planConfig.maxOrdersPerMonth === Infinity ? 0 : Math.round((ordersThisMonth / planConfig.maxOrdersPerMonth) * 100),
    };

    // Infinity no es serializable a JSON → convertir a -1 (frontend lo interpreta como ilimitado)
    const serializeLimit = (value) => (value === Infinity ? -1 : value);

    const availablePlans = Object.entries(PLAN_CONFIGS).map(([key, config]) => ({
      id: key,
      name: key.charAt(0).toUpperCase() + key.slice(1),
      price: config.price,
      maxUsers: serializeLimit(config.maxUsers),
      maxProducts: serializeLimit(config.maxProducts),
      maxOrdersPerMonth: serializeLimit(config.maxOrdersPerMonth),
      features: config.features,
      isCurrent: key === tenant.plan,
    }));

    return res.json({
      success: true,
      plan: {
        current: tenant.plan,
        status: tenant.status,
        limits: {
          maxUsers: serializeLimit(tenant.limits?.maxUsers),
          maxProducts: serializeLimit(tenant.limits?.maxProducts),
          maxOrdersPerMonth: serializeLimit(tenant.limits?.maxOrdersPerMonth),
        },
        usage: { currentUsers: totalUsers, currentProducts: totalProducts, ordersThisMonth },
        usagePercentages,
        billing: tenant.billing,
        trialEndsAt: tenant.trialEndsAt,
      },
      availablePlans,
    });
  } catch (error) {
    return handleServerError(res, error, "Error al obtener plan");
  }
};

exports.changePlan = async (req, res) => {
  try {
    const { plan } = req.body;
    if (!plan || !PLAN_CONFIGS[plan]) {
      return res.status(400).json({ success: false, message: "Plan inválido" });
    }

    const tenant = await Tenant.findById(req.user.tenant);
    if (!tenant) {
      return res.status(404).json({ success: false, message: "Tenant no encontrado" });
    }

    const oldPlan = tenant.plan;
    const planConfig = PLAN_CONFIGS[plan];

    tenant.plan = plan;
    tenant.limits = {
      maxUsers: planConfig.maxUsers,
      maxProducts: planConfig.maxProducts,
      maxOrdersPerMonth: planConfig.maxOrdersPerMonth,
    };
    tenant.enabledFeatures = planConfig.features;
    await tenant.save();

    return res.json({
      success: true,
      message: `Plan actualizado a ${plan}`,
      plan: {
        current: tenant.plan,
        limits: tenant.limits,
        enabledFeatures: tenant.enabledFeatures,
      },
    });
  } catch (error) {
    return handleServerError(res, error, "Error al cambiar plan");
  }
};
