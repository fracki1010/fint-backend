const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const User = require("../models/user.model");
const Tenant = require("../models/tenant.model");
const Setting = require("../models/setting.model");
const {
  getRequiredEnv,
  isBootstrapEnabled,
  isProduction,
} = require("../config/runtime");
const { sendError, handleServerError } = require("../utils/http");

const generateToken = (userId) => {
  const jwtSecret = getRequiredEnv("JWT_SECRET");

  return jwt.sign({ userId }, jwtSecret, {
    expiresIn: "7d",
  });
};

const serializeLimit = (value) => (value === Infinity || value === null || value === undefined ? -1 : value);

const toAuthResponse = async (user) => {
  const tenant = await Tenant.findById(user.tenant).lean();
  return {
    token: generateToken(user._id.toString()),
    user: {
      _id: user._id,
      fullName: user.fullName,
      email: user.email,
      role: user.role || "admin",
      isActive: user.isActive,
      isSuperAdmin: user.isSuperAdmin,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      tenant: tenant
        ? {
            _id: tenant._id,
            name: tenant.name,
            plan: tenant.plan,
            status: tenant.status,
            limits: tenant.limits ? {
              maxUsers: serializeLimit(tenant.limits.maxUsers),
              maxProducts: serializeLimit(tenant.limits.maxProducts),
              maxOrdersPerMonth: serializeLimit(tenant.limits.maxOrdersPerMonth),
            } : undefined,
            enabledFeatures: (() => {
              const PLAN_FEATURES = {
                essential: [],
                business: ["financial_center", "recipes", "supplier_account", "client_account", "team_management", "unlimited_products", "unlimited_orders", "banking"],
                enterprise: ["financial_center", "recipes", "advanced_reports", "api_access", "supplier_account", "client_account", "team_management", "unlimited_products", "unlimited_orders", "banking"],
              };
              const base = PLAN_FEATURES[tenant.plan] || [];
              const extra = tenant.enabledFeatures || [];
              return [...new Set([...base, ...extra])];
            })(),
            usage: tenant.usage,
            trialEndsAt: tenant.trialEndsAt,
          }
        : null,
    },
  };
};

const createUserInternal = async ({
  fullName,
  email,
  password,
  isSuperAdmin = false,
  storeName = "",
}) => {
  const cleanName = (fullName || "").toString().trim();
  const cleanEmail = (email || "").toString().trim().toLowerCase();
  const cleanPassword = (password || "").toString();

  if (!cleanName || !cleanEmail || cleanPassword.length < 6) {
    const error = new Error(
      "Datos invalidos. Nombre y email requeridos, password minimo 6 caracteres.",
    );
    error.statusCode = 400;
    throw error;
  }

  const existingUser = await User.findOne({ email: cleanEmail });
  if (existingUser) {
    const error = new Error("El email ya esta registrado");
    error.statusCode = 409;
    throw error;
  }

  const passwordHash = await bcrypt.hash(cleanPassword, 10);
  // Self-registration: Essential con 14 días de trial
  const trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
  const tenant = await Tenant.create({
    name: storeName || cleanName,
    plan: "essential",
    trialEndsAt,
  });

  const user = await User.create({
    tenant: tenant._id,
    fullName: cleanName,
    email: cleanEmail,
    passwordHash,
    isSuperAdmin,
  });

  await Setting.create({
    tenant: tenant._id,
    storeName: storeName || cleanName,
    admin: {
      fullName: cleanName,
      role: isSuperAdmin ? "Super Admin" : "Administrador",
      email: cleanEmail,
      company: {
        name: storeName || cleanName,
        email: cleanEmail,
      },
    },
  });

  return user;
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    const cleanEmail = (email || "").toString().trim().toLowerCase();
    const cleanPassword = (password || "").toString();

    const user = await User.findOne({ email: cleanEmail });
    if (!user || !user.isActive) {
      return sendError(res, {
        status: 401,
        code: "INVALID_CREDENTIALS",
        message: "Credenciales invalidas",
      });
    }

    const passwordOk = await bcrypt.compare(cleanPassword, user.passwordHash);
    if (!passwordOk) {
      return sendError(res, {
        status: 401,
        code: "INVALID_CREDENTIALS",
        message: "Credenciales invalidas",
      });
    }

    user.lastLoginAt = new Date();
    await user.save();

    return res.json(await toAuthResponse(user));
  } catch (error) {
    return handleServerError(res, error, "Error al iniciar sesion");
  }
};

exports.me = async (req, res) => {
  const u = req.user;
  const tenant = await Tenant.findById(u.tenant).lean();
  return res.json({
    user: {
      _id: u._id,
      fullName: u.fullName,
      email: u.email,
      role: u.role || "admin",
      isActive: u.isActive,
      isSuperAdmin: u.isSuperAdmin,
      createdAt: u.createdAt,
      updatedAt: u.updatedAt,
      tenant: tenant
        ? {
            _id: tenant._id,
            name: tenant.name,
            plan: tenant.plan,
            status: tenant.status,
            limits: tenant.limits,
            enabledFeatures: (() => {
              const PLAN_FEATURES = {
                essential: [],
                business: ["financial_center", "recipes", "supplier_account", "client_account", "team_management", "unlimited_products", "unlimited_orders", "banking"],
                enterprise: ["financial_center", "recipes", "advanced_reports", "api_access", "supplier_account", "client_account", "team_management", "unlimited_products", "unlimited_orders", "banking"],
              };
              const base = PLAN_FEATURES[tenant.plan] || [];
              const extra = tenant.enabledFeatures || [];
              return [...new Set([...base, ...extra])];
            })(),
            usage: tenant.usage,
            trialEndsAt: tenant.trialEndsAt,
          }
        : null,
    },
  });
};

exports.bootstrapSuperAdmin = async (req, res) => {
  try {
    if (isProduction()) {
      return sendError(res, {
        status: 404,
        code: "NOT_FOUND",
        message: "Ruta no disponible",
      });
    }

    if (!isBootstrapEnabled()) {
      return sendError(res, {
        status: 404,
        code: "NOT_FOUND",
        message: "Ruta no disponible",
      });
    }

    const usersCount = await User.countDocuments();
    if (usersCount > 0) {
      return res
        .status(409)
        .json({
          error: {
            code: "BOOTSTRAP_ALREADY_EXECUTED",
            message: "Bootstrap ya ejecutado. Ya existen usuarios.",
          },
        });
    }

    const { setupKey, fullName, email, password, storeName } = req.body;
    const expectedKey = getRequiredEnv("ADMIN_SETUP_KEY");
    if (!setupKey || setupKey !== expectedKey) {
      return sendError(res, {
        status: 403,
        code: "INVALID_SETUP_KEY",
        message: "Clave de bootstrap invalida",
      });
    }

    const user = await createUserInternal({
      fullName,
      email,
      password,
      isSuperAdmin: true,
      storeName,
    });

    return res.status(201).json(await toAuthResponse(user));
  } catch (error) {
    return handleServerError(
      res,
      error,
      error.message || "Error en bootstrap de super admin",
    );
  }
};

exports.createUser = async (req, res) => {
  try {
    if (!req.user?.isSuperAdmin) {
      return sendError(res, {
        status: 403,
        code: "FORBIDDEN",
        message: "Solo superadmin puede crear cuentas",
      });
    }

    const { fullName, email, password, storeName } = req.body;
    const user = await createUserInternal({
      fullName,
      email,
      password,
      isSuperAdmin: false,
      storeName,
    });

    return res.status(201).json({
      user: {
        _id: user._id,
        fullName: user.fullName,
        email: user.email,
        isActive: user.isActive,
        isSuperAdmin: user.isSuperAdmin,
      },
    });
  } catch (error) {
    return handleServerError(
      res,
      error,
      error.message || "Error al crear usuario",
    );
  }
};
