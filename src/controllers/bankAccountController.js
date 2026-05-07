const BankAccount = require("../models/bankAccount.model");
const { sendError, handleServerError } = require("../utils/http");

/**
 * GET /api/banking/accounts
 * List bank accounts scoped to tenant
 */
exports.listAccounts = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;

    if (!tenantId) {
      return sendError(res, {
        status: 401,
        code: "UNAUTHORIZED",
        message: "Tenant no identificado",
      });
    }

    const includeInactive = req.query.includeInactive === "true";
    const filter = { tenant: tenantId };
    if (!includeInactive) filter.isActive = true;

    const accounts = await BankAccount.find(filter).sort({ name: 1 });

    return res.json({ success: true, data: accounts });
  } catch (error) {
    return handleServerError(res, error, "Error al obtener cuentas bancarias");
  }
};

/**
 * GET /api/banking/accounts/:id
 * Get a single bank account by ID
 */
exports.getAccount = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;

    if (!tenantId) {
      return sendError(res, {
        status: 401,
        code: "UNAUTHORIZED",
        message: "Tenant no identificado",
      });
    }

    const account = await BankAccount.findOne({
      _id: req.params.id,
      tenant: tenantId,
    });

    if (!account) {
      return sendError(res, {
        status: 404,
        code: "NOT_FOUND",
        message: "Cuenta bancaria no encontrada",
      });
    }

    return res.json({ success: true, data: account });
  } catch (error) {
    return handleServerError(res, error, "Error al obtener cuenta bancaria");
  }
};

/**
 * POST /api/banking/accounts
 * Create a new bank account
 */
exports.createAccount = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;

    if (!tenantId) {
      return sendError(res, {
        status: 401,
        code: "UNAUTHORIZED",
        message: "Tenant no identificado",
      });
    }

    const { name, bank, accountNumber, type, currency, currentBalance, isActive } =
      req.body;

    const account = await BankAccount.create({
      tenant: tenantId,
      name,
      bank,
      accountNumber,
      type,
      currency,
      currentBalance,
      isActive,
    });

    return res.status(201).json({
      success: true,
      message: "Cuenta bancaria creada exitosamente",
      data: account,
    });
  } catch (error) {
    return handleServerError(res, error, "Error al crear cuenta bancaria");
  }
};

/**
 * PUT /api/banking/accounts/:id
 * Update a bank account
 */
exports.updateAccount = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;

    if (!tenantId) {
      return sendError(res, {
        status: 401,
        code: "UNAUTHORIZED",
        message: "Tenant no identificado",
      });
    }

    const allowedFields = [
      "name",
      "bank",
      "accountNumber",
      "type",
      "currency",
      "currentBalance",
      "isActive",
    ];
    const updates = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }

    const account = await BankAccount.findOneAndUpdate(
      { _id: req.params.id, tenant: tenantId },
      { $set: updates },
      { new: true, runValidators: true },
    );

    if (!account) {
      return sendError(res, {
        status: 404,
        code: "NOT_FOUND",
        message: "Cuenta bancaria no encontrada",
      });
    }

    return res.json({
      success: true,
      message: "Cuenta bancaria actualizada exitosamente",
      data: account,
    });
  } catch (error) {
    return handleServerError(res, error, "Error al actualizar cuenta bancaria");
  }
};

/**
 * PATCH /api/banking/accounts/:id/toggle
 * Toggle isActive status (shorthand for quick activate/deactivate)
 */
exports.toggleAccountActive = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;

    if (!tenantId) {
      return sendError(res, {
        status: 401,
        code: "UNAUTHORIZED",
        message: "Tenant no identificado",
      });
    }

    const account = await BankAccount.findOne({
      _id: req.params.id,
      tenant: tenantId,
    });

    if (!account) {
      return sendError(res, {
        status: 404,
        code: "NOT_FOUND",
        message: "Cuenta bancaria no encontrada",
      });
    }

    account.isActive = !account.isActive;
    await account.save();

    return res.json({
      success: true,
      message: account.isActive
        ? "Cuenta bancaria activada exitosamente"
        : "Cuenta bancaria desactivada exitosamente",
      data: account,
    });
  } catch (error) {
    return handleServerError(res, error, "Error al cambiar estado de cuenta bancaria");
  }
};
