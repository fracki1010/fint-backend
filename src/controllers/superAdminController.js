const Tenant = require("../models/tenant.model");
const User = require("../models/user.model");
const Product = require("../models/product.model");
const Order = require("../models/order.model");
const AuditLog = require("../models/auditLog.model");
const { handleServerError } = require("../utils/http");
const { sendEmail, buildWelcomeEmail } = require("../services/emailService");
const bcrypt = require("bcryptjs");

// Helper: Plan configurations
const PLAN_CONFIGS = {
  essential: {
    maxUsers: 3,
    maxProducts: 200,
    maxOrdersPerMonth: 500,
    features: [],
  },
  business: {
    maxUsers: 10,
    maxProducts: Infinity,
    maxOrdersPerMonth: Infinity,
    features: ["financial_center", "recipes"],
  },
  enterprise: {
    maxUsers: Infinity,
    maxProducts: Infinity,
    maxOrdersPerMonth: Infinity,
    features: ["financial_center", "recipes", "advanced_reports", "api_access"],
  },
};

/**
 * @desc    Get all tenants with pagination and filters
 * @route   GET /api/superadmin/tenants
 * @access  SuperAdmin only
 */
const getAllTenants = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      plan,
      status = "active",
      search,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = req.query;

    // Build filter
    const filter = {};
    
    if (plan) filter.plan = plan;
    if (status) filter.status = status;
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: "i" } },
      ];
    }

    // Build sort
    const sort = {};
    sort[sortBy] = sortOrder === "asc" ? 1 : -1;

    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const skip = (pageNum - 1) * limitNum;

    const [tenants, total] = await Promise.all([
      Tenant.find(filter)
        .sort(sort)
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Tenant.countDocuments(filter),
    ]);

    return res.json({
      success: true,
      tenants,
      pagination: {
        total,
        page: pageNum,
        pages: Math.ceil(total / limitNum),
        limit: limitNum,
      },
    });
  } catch (error) {
    return handleServerError(res, error, "Error al obtener tenants");
  }
};

/**
 * @desc    Get single tenant with stats
 * @route   GET /api/superadmin/tenants/:id
 * @access  SuperAdmin only
 */
const getTenantById = async (req, res) => {
  try {
    const tenant = await Tenant.findById(req.params.id).lean();
    
    if (!tenant) {
      return res.status(404).json({
        success: false,
        message: "Tenant no encontrado",
      });
    }

    // Get admin user
    const adminUser = await User.findOne({ 
      tenant: tenant._id, 
      role: "admin" 
    }).select("fullName email phone").lean();

    // Get basic stats
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const [totalUsers, totalProducts, totalOrders, ordersThisMonth] = await Promise.all([
      User.countDocuments({ tenant: tenant._id, isActive: true }),
      Product.countDocuments({ tenant: tenant._id }),
      Order.countDocuments({ tenant: tenant._id }),
      Order.countDocuments({ tenant: tenant._id, createdAt: { $gte: startOfMonth } }),
    ]);

    // Update tenant usage in background
    await Tenant.findByIdAndUpdate(tenant._id, {
      $set: {
        "usage.currentUsers": totalUsers,
        "usage.currentProducts": totalProducts,
        "usage.ordersThisMonth": ordersThisMonth,
      },
    });

    // Calculate usage percentages
    const planConfig = PLAN_CONFIGS[tenant.plan] || PLAN_CONFIGS.essential;
    
    const usagePercentages = {
      users: planConfig.maxUsers === Infinity ? 0 : Math.round((totalUsers / planConfig.maxUsers) * 100),
      products: planConfig.maxProducts === Infinity ? 0 : Math.round((totalProducts / planConfig.maxProducts) * 100),
    };

    return res.json({
      success: true,
      tenant: {
        ...tenant,
        usage: {
          currentUsers: totalUsers,
          currentProducts: totalProducts,
          ordersThisMonth,
        },
      },
      adminUser,
      stats: {
        totalUsers,
        totalProducts,
        totalOrders,
      },
      usagePercentages,
    });
  } catch (error) {
    return handleServerError(res, error, "Error al obtener tenant");
  }
};

/**
 * @desc    Create new tenant with admin user
 * @route   POST /api/superadmin/tenants
 * @access  SuperAdmin only
 */
const createTenant = async (req, res) => {
  try {
    const {
      businessName,
      adminEmail,
      adminName,
      adminPhone,
      plan = "essential",
      passwordType = "auto", // "auto" or "custom"
      customPassword,
      sendWelcomeEmail = false,
      notes,
    } = req.body;

    // Validate required fields
    if (!businessName || !adminEmail || !adminName) {
      return res.status(400).json({
        success: false,
        message: "Nombre del negocio, email y nombre del admin son requeridos",
      });
    }

    // Check if email already exists
    const existingUser = await User.findOne({ email: adminEmail.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: "El email ya está registrado",
      });
    }

    // Generate password
    let tempPassword;
    if (passwordType === "custom" && customPassword) {
      tempPassword = customPassword;
    } else {
      tempPassword = Math.random().toString(36).slice(-10) + Math.random().toString(36).slice(-2).toUpperCase();
    }

    const hashedPassword = await bcrypt.hash(tempPassword, 10);

    // Get plan configuration
    const planConfig = PLAN_CONFIGS[plan] || PLAN_CONFIGS.essential;

    // Create tenant with 14-day trial
    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + 14);

    const tenant = await Tenant.create({
      name: businessName,
      plan,
      status: "active",
      limits: {
        maxUsers: planConfig.maxUsers,
        maxProducts: planConfig.maxProducts,
        maxOrdersPerMonth: planConfig.maxOrdersPerMonth,
      },
      enabledFeatures: planConfig.features,
      metadata: {
        source: "manual",
        notes,
        createdBy: req.user._id,
      },
      trialEndsAt,
    });

    // Create admin user
    const adminUser = await User.create({
      fullName: adminName,
      email: adminEmail.toLowerCase(),
      phone: adminPhone,
      password: hashedPassword,
      role: "admin",
      tenant: tenant._id,
      isActive: true,
    });

    // Send welcome email if requested
    if (sendWelcomeEmail) {
      const { subject, html, text } = buildWelcomeEmail({
        businessName,
        adminName,
        email: adminEmail,
        tempPassword: passwordType === "auto" ? tempPassword : undefined,
        plan,
        trialEndsAt: tenant.trialEndsAt,
      });
      await sendEmail({ to: adminEmail, subject, html, text });
    }

    // Create audit log
    await AuditLog.create({
      action: "tenant.created",
      admin: req.user._id,
      tenant: tenant._id,
      details: {
        businessName,
        plan,
        adminEmail,
        passwordType,
        sendWelcomeEmail,
      },
      ip: req.ip,
      userAgent: req.headers["user-agent"],
    });

    return res.status(201).json({
      success: true,
      message: "Tenant creado exitosamente",
      tenant,
      adminUser: {
        _id: adminUser._id,
        fullName: adminUser.fullName,
        email: adminUser.email,
      },
      credentials: {
        email: adminEmail,
        tempPassword: passwordType === "auto" ? tempPassword : undefined,
      },
    });
  } catch (error) {
    return handleServerError(res, error, "Error al crear tenant");
  }
};

/**
 * @desc    Update tenant (plan, status, limits, etc.)
 * @route   PATCH /api/superadmin/tenants/:id
 * @access  SuperAdmin only
 */
const updateTenant = async (req, res) => {
  try {
    const { plan, status, limits, enabledFeatures, billing, metadata } = req.body;
    
    const tenant = await Tenant.findById(req.params.id);
    if (!tenant) {
      return res.status(404).json({
        success: false,
        message: "Tenant no encontrado",
      });
    }

    const oldPlan = tenant.plan;
    const updates = {};

    // Update plan
    if (plan && PLAN_CONFIGS[plan]) {
      updates.plan = plan;
      const planConfig = PLAN_CONFIGS[plan];
      updates.limits = {
        maxUsers: planConfig.maxUsers,
        maxProducts: planConfig.maxProducts,
        maxOrdersPerMonth: planConfig.maxOrdersPerMonth,
      };
      updates.enabledFeatures = planConfig.features;
    }

    // Update status
    if (status) updates.status = status;
    
    // Update custom limits (override plan defaults)
    if (limits) updates.limits = { ...tenant.limits, ...limits };
    
    // Update features
    if (enabledFeatures) updates.enabledFeatures = enabledFeatures;
    
    // Update billing
    if (billing) updates.billing = { ...tenant.billing, ...billing };
    
    // Update metadata
    if (metadata) updates.metadata = { ...tenant.metadata, ...metadata };

    const updatedTenant = await Tenant.findByIdAndUpdate(
      req.params.id,
      { $set: updates },
      { new: true }
    );

    // Create audit log
    await AuditLog.create({
      action: plan && plan !== oldPlan ? "tenant.plan_changed" : "tenant.updated",
      admin: req.user._id,
      tenant: tenant._id,
      details: {
        oldPlan,
        newPlan: plan || oldPlan,
        changes: Object.keys(updates),
      },
      ip: req.ip,
      userAgent: req.headers["user-agent"],
    });

    return res.json({
      success: true,
      message: "Tenant actualizado exitosamente",
      tenant: updatedTenant,
    });
  } catch (error) {
    return handleServerError(res, error, "Error al actualizar tenant");
  }
};

/**
 * @desc    Suspend/Activate tenant (soft delete)
 * @route   DELETE /api/superadmin/tenants/:id
 * @access  SuperAdmin only
 */
const suspendTenant = async (req, res) => {
  try {
    const tenant = await Tenant.findById(req.params.id);
    if (!tenant) {
      return res.status(404).json({
        success: false,
        message: "Tenant no encontrado",
      });
    }

    const newStatus = tenant.status === "active" ? "suspended" : "active";
    const action = newStatus === "suspended" ? "tenant.suspended" : "tenant.activated";

    tenant.status = newStatus;
    await tenant.save();

    // Create audit log
    await AuditLog.create({
      action,
      admin: req.user._id,
      tenant: tenant._id,
      details: { previousStatus: tenant.status },
      ip: req.ip,
      userAgent: req.headers["user-agent"],
    });

    return res.json({
      success: true,
      message: `Tenant ${newStatus === "suspended" ? "suspendido" : "activado"} exitosamente`,
      tenant,
    });
  } catch (error) {
    return handleServerError(res, error, "Error al cambiar estado del tenant");
  }
};

/**
 * @desc    Get system-wide analytics
 * @route   GET /api/superadmin/analytics
 * @access  SuperAdmin only
 */
const getAnalytics = async (req, res) => {
  try {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    
    const [
      totalTenants,
      activeTenants,
      suspendedTenants,
      cancelledTenants,
      newThisMonth,
      planDistribution,
    ] = await Promise.all([
      Tenant.countDocuments(),
      Tenant.countDocuments({ status: "active" }),
      Tenant.countDocuments({ status: "suspended" }),
      Tenant.countDocuments({ status: "cancelled" }),
      Tenant.countDocuments({ createdAt: { $gte: startOfMonth } }),
      Tenant.aggregate([
        { $group: { _id: "$plan", count: { $sum: 1 } } },
      ]),
    ]);

    // Calculate MRR
    const prices = { essential: 2, business: 3, enterprise: 8 };
    let mrr = 0;
    planDistribution.forEach(p => {
      mrr += (p.count * (prices[p._id] || 0));
    });

    return res.json({
      success: true,
      analytics: {
        overview: {
          totalTenants,
          activeTenants,
          suspendedTenants,
          cancelledTenants,
          newThisMonth,
        },
        plans: planDistribution.reduce((acc, curr) => {
          acc[curr._id] = { count: curr.count, percentage: Math.round((curr.count / totalTenants) * 100) };
          return acc;
        }, {}),
        revenue: {
          mrr,
          arr: mrr * 12,
        },
      },
    });
  } catch (error) {
    return handleServerError(res, error, "Error al obtener analytics");
  }
};

/**
 * @desc    Get audit logs
 * @route   GET /api/superadmin/audit
 * @access  SuperAdmin only
 */
const getAuditLogs = async (req, res) => {
  try {
    const { page = 1, limit = 50, action, tenantId, adminId, dateFrom, dateTo } = req.query;
    
    const filter = {};
    if (action) filter.action = action;
    if (tenantId) filter.tenant = tenantId;
    if (adminId) filter.admin = adminId;
    if (dateFrom || dateTo) {
      filter.timestamp = {};
      if (dateFrom) filter.timestamp.$gte = new Date(dateFrom);
      if (dateTo) filter.timestamp.$lte = new Date(dateTo);
    }

    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const skip = (pageNum - 1) * limitNum;

    const [logs, total] = await Promise.all([
      AuditLog.find(filter)
        .populate("admin", "fullName email")
        .populate("tenant", "name plan")
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      AuditLog.countDocuments(filter),
    ]);

    return res.json({
      success: true,
      logs,
      pagination: {
        total,
        page: pageNum,
        pages: Math.ceil(total / limitNum),
        limit: limitNum,
      },
    });
  } catch (error) {
    return handleServerError(res, error, "Error al obtener audit logs");
  }
};

module.exports = {
  getAllTenants,
  getTenantById,
  createTenant,
  updateTenant,
  suspendTenant,
  getAnalytics,
  getAuditLogs,
};
