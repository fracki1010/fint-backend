const Tenant = require("../models/tenant.model");
const User = require("../models/user.model");
const Setting = require("../models/setting.model");
const { Product } = require("../models/product.model");
const Order = require("../models/order.model");
const AuditLog = require("../models/auditLog.model");
const SystemConfig = require("../models/systemConfig.model");
const { handleServerError } = require("../utils/http");
const { sendEmail, buildWelcomeEmail } = require("../services/emailService");
const bcrypt = require("bcryptjs");
const {
  COMPLEMENTS,
  APP_BASE,
  deriveEnabledFeatures,
  deriveLimits,
  computeTotalPrice,
} = require("../config/complementConfig");

const serializeLimit = (value) => (value === Infinity ? -1 : value);

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
      status = "active",
      search,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = req.query;

    // Build filter
    const filter = {};
    
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

    // Get settings for supportEmail
    const settings = await Setting.findOne({ tenant: tenant._id }).select("supportEmail").lean();

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

    // Calculate usage percentages from complements
    const limits = deriveLimits(tenant.complements);
    
    const usagePercentages = {
      users: limits.maxUsers === Infinity || limits.maxUsers === -1 ? 0 : Math.round((totalUsers / limits.maxUsers) * 100),
      products: limits.maxProducts === Infinity || limits.maxProducts === -1 ? 0 : Math.round((totalProducts / limits.maxProducts) * 100),
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
      settings: {
        supportEmail: settings?.supportEmail || "",
      },
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
      complements = [],
      passwordType = "auto", // "auto" or "custom"
      customPassword,
      sendWelcomeEmail = false,
      supportEmail,
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

    // Validate complement IDs if provided
    for (const compId of complements) {
      if (!COMPLEMENTS[compId]) {
        return res.status(400).json({
          success: false,
          message: `Complemento inválido: ${compId}`,
        });
      }
    }

    // All new tenants default to app_base
    const trialDays = 14;
    const trialEndsAt = new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000);

    const tenant = await Tenant.create({
      name: businessName,
      plan: "app_base",
      status: "active",
      limits: deriveLimits(complements),
      enabledFeatures: deriveEnabledFeatures(complements),
      complements,
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
      passwordHash: hashedPassword,
      role: "admin",
      tenant: tenant._id,
      isActive: true,
    });

    // Create settings with supportEmail
    await Setting.create({
      tenant: tenant._id,
      storeName: businessName,
      email: adminEmail,
      supportEmail: supportEmail || "",
      admin: {
        fullName: adminName,
        role: "Administrador",
        email: adminEmail,
        phone: adminPhone || "",
        company: {
          name: businessName,
          email: supportEmail || adminEmail,
        },
      },
    });

    // Send welcome email if requested (best-effort, don't break tenant creation)
    let emailSent = false;
    let emailError = null;
    if (sendWelcomeEmail) {
      try {
        const { subject, html, text } = buildWelcomeEmail({
          businessName,
          adminName,
          email: adminEmail,
          tempPassword: passwordType === "auto" ? tempPassword : undefined,
          plan: "app_base",
          complements,
          trialEndsAt: tenant.trialEndsAt,
        });
        console.log("[SUPERADMIN] Attempting to send welcome email to:", adminEmail);
        const result = await sendEmail({ to: adminEmail, subject, html, text });
        emailSent = true;
        console.log("[SUPERADMIN] Welcome email sent successfully:", result.messageId);
      } catch (err) {
        emailError = err.message;
        console.error("[SUPERADMIN] Welcome email failed:", err.message);
        console.error("[SUPERADMIN] SMTP_HOST:", process.env.SMTP_HOST || "NOT SET");
        console.error("[SUPERADMIN] EMAIL_FROM:", process.env.EMAIL_FROM || "NOT SET");
      }
    }

    // Create audit log
    await AuditLog.create({
      action: "tenant.created",
      admin: req.user._id,
      tenant: tenant._id,
      details: {
        businessName,
        plan: "app_base",
        complements,
        adminEmail,
        passwordType,
        sendWelcomeEmail,
      },
      ip: req.ip,
      userAgent: req.headers["user-agent"],
    });

    return res.status(201).json({
      success: true,
      message: emailError
        ? "Tenant creado exitosamente, pero no se pudo enviar el email de bienvenida."
        : "Tenant creado exitosamente",
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
      emailSent,
      emailError: emailError || undefined,
    });
  } catch (error) {
    return handleServerError(res, error, "Error al crear tenant");
  }
};

/**
 * @desc    Update tenant (complements, status, limits, etc.)
 * @route   PATCH /api/superadmin/tenants/:id
 * @access  SuperAdmin only
 */
const updateTenant = async (req, res) => {
  try {
    const { complements, status, limits, enabledFeatures, billing, metadata } = req.body;
    
    const tenant = await Tenant.findById(req.params.id);
    if (!tenant) {
      return res.status(404).json({
        success: false,
        message: "Tenant no encontrado",
      });
    }

    const oldComplements = [...(tenant.complements || [])];
    const updates = {};

    // Update complements
    if (complements !== undefined) {
      // Validate complement IDs
      for (const compId of complements) {
        if (!COMPLEMENTS[compId]) {
          return res.status(400).json({
            success: false,
            message: `Complemento inválido: ${compId}`,
          });
        }
      }
      updates.complements = complements;
      updates.limits = deriveLimits(complements);
      updates.enabledFeatures = deriveEnabledFeatures(complements);
    }

    // Update status
    if (status) updates.status = status;
    
    // Update custom limits (override complement defaults)
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
    const complementChanged = complements !== undefined && JSON.stringify(oldComplements) !== JSON.stringify(complements);
    await AuditLog.create({
      action: complementChanged ? "tenant.plan_changed" : "tenant.updated",
      admin: req.user._id,
      tenant: tenant._id,
      details: {
        oldComplements,
        newComplements: complements || oldComplements,
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
    ] = await Promise.all([
      Tenant.countDocuments(),
      Tenant.countDocuments({ status: "active" }),
      Tenant.countDocuments({ status: "suspended" }),
      Tenant.countDocuments({ status: "cancelled" }),
      Tenant.countDocuments({ createdAt: { $gte: startOfMonth } }),
    ]);

    // Calculate MRR from active tenants' complements
    const activeTenantList = await Tenant.find({ status: "active" }).select("complements").lean();
    let mrr = 0;
    for (const t of activeTenantList) {
      mrr += computeTotalPrice(t.complements || []);
    }

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

/**
 * @desc    Get current complement pricing
 * @route   GET /api/superadmin/pricing
 * @access  SuperAdmin only
 */
const getPricing = async (req, res) => {
  try {
    const config = await SystemConfig.findOne({ key: "global" }).lean();
    
    // Merge default prices from config with any overrides from DB
    const defaultPrices = {};
    Object.entries(COMPLEMENTS).forEach(([id, comp]) => {
      defaultPrices[id] = comp.price;
    });

    const overrides = config?.complementPricing || {};
    const appBasePrice = config?.appBasePrice || APP_BASE.price;

    return res.json({
      success: true,
      appBasePrice,
      defaultPrices,
      overrides,
      // Computed effective prices
      effectivePrices: {
        appBase: appBasePrice,
        ...Object.fromEntries(
          Object.keys(COMPLEMENTS).map((id) => [
            id,
            overrides[id] !== undefined ? overrides[id] : defaultPrices[id],
          ])
        ),
      },
    });
  } catch (error) {
    return handleServerError(res, error, "Error al obtener precios");
  }
};

/**
 * @desc    Update complement pricing
 * @route   PUT /api/superadmin/pricing
 * @access  SuperAdmin only
 */
const updatePricing = async (req, res) => {
  try {
    const { appBasePrice, complementPricing } = req.body;

    // Validate complement IDs
    if (complementPricing) {
      for (const compId of Object.keys(complementPricing)) {
        if (compId !== "appBase" && !COMPLEMENTS[compId]) {
          return res.status(400).json({
            success: false,
            message: `Complemento inválido: ${compId}`,
          });
        }
      }
    }

    const config = await SystemConfig.findOneAndUpdate(
      { key: "global" },
      {
        $set: {
          ...(appBasePrice !== undefined && { appBasePrice }),
          ...(complementPricing !== undefined && { complementPricing }),
        },
      },
      { upsert: true, new: true }
    );

    await AuditLog.create({
      action: "system.pricing_updated",
      admin: req.user._id,
      details: { appBasePrice, complementPricing },
      ip: req.ip,
      userAgent: req.headers["user-agent"],
    });

    return res.json({
      success: true,
      message: "Precios actualizados",
      pricing: config,
    });
  } catch (error) {
    return handleServerError(res, error, "Error al actualizar precios");
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
  getPricing,
  updatePricing,
};
