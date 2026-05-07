const bankReconciliationService = require("../services/bankReconciliationService");
const { sendError, handleServerError } = require("../utils/http");

/**
 * GET /api/banking/accounts/:id/reconciliation
 * Get reconciliation data (bank transactions + candidate records) for a date range.
 */
exports.getReconciliationData = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;

    if (!tenantId) {
      return sendError(res, {
        status: 401,
        code: "UNAUTHORIZED",
        message: "Tenant no identificado",
      });
    }

    const bankAccountId = req.params.id;
    const { dateFrom, dateTo } = req.query;

    if (!dateFrom || !dateTo) {
      return sendError(res, {
        status: 400,
        code: "VALIDATION_ERROR",
        message: "Los parámetros dateFrom y dateTo son requeridos",
      });
    }

    const data = await bankReconciliationService.getReconciliationData(
      tenantId,
      bankAccountId,
      new Date(dateFrom),
      new Date(dateTo),
    );

    return res.json({ success: true, data });
  } catch (error) {
    return handleServerError(res, error, "Error al obtener datos de conciliación");
  }
};

/**
 * PUT /api/banking/transactions/:id/match
 * Match a bank transaction to an internal record.
 */
exports.matchTransaction = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;

    if (!tenantId) {
      return sendError(res, {
        status: 401,
        code: "UNAUTHORIZED",
        message: "Tenant no identificado",
      });
    }

    const transactionId = req.params.id;
    const { matchedEntryType, matchedEntryId } = req.body;

    const transaction = await bankReconciliationService.matchTransaction(
      tenantId,
      transactionId,
      matchedEntryType,
      matchedEntryId,
    );

    return res.json({
      success: true,
      message: "Transacción reconciliada exitosamente",
      data: transaction,
    });
  } catch (error) {
    if (error.status === 404 || error.status === 409) {
      return sendError(res, {
        status: error.status,
        code: error.code,
        message: error.message,
      });
    }
    return handleServerError(res, error, "Error al reconciliar transacción");
  }
};

/**
 * PUT /api/banking/transactions/:id/unmatch
 * Unmatch a reconciled transaction, reverting to cleared.
 */
exports.unmatchTransaction = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;

    if (!tenantId) {
      return sendError(res, {
        status: 401,
        code: "UNAUTHORIZED",
        message: "Tenant no identificado",
      });
    }

    const transactionId = req.params.id;

    const transaction = await bankReconciliationService.unmatchTransaction(
      tenantId,
      transactionId,
    );

    return res.json({
      success: true,
      message: "Transacción desreconciliada exitosamente",
      data: transaction,
    });
  } catch (error) {
    if (error.status === 404 || error.status === 400) {
      return sendError(res, {
        status: error.status,
        code: error.code,
        message: error.message,
      });
    }
    return handleServerError(res, error, "Error al desreconciliar transacción");
  }
};

/**
 * POST /api/banking/accounts/:id/confirm-reconciliation
 * Confirm reconciliation: update balance and finalize period.
 */
exports.confirmReconciliation = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;

    if (!tenantId) {
      return sendError(res, {
        status: 401,
        code: "UNAUTHORIZED",
        message: "Tenant no identificado",
      });
    }

    const bankAccountId = req.params.id;
    const { endDate } = req.body;

    if (!endDate) {
      return sendError(res, {
        status: 400,
        code: "VALIDATION_ERROR",
        message: "El parámetro endDate es requerido",
      });
    }

    const result = await bankReconciliationService.confirmReconciliation(
      tenantId,
      bankAccountId,
      endDate,
    );

    return res.json({
      success: true,
      message: `Conciliación confirmada. ${result.reconciledCount} transacciones reconciliadas.`,
      data: result,
    });
  } catch (error) {
    if (error.status === 404) {
      return sendError(res, {
        status: error.status,
        code: error.code,
        message: error.message,
      });
    }
    return handleServerError(res, error, "Error al confirmar conciliación");
  }
};
