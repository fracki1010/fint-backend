const cashClosingService = require("../services/cashClosingService");
const { sendError, handleServerError } = require("../utils/http");

/**
 * POST /api/cash-closing/open
 * Create a new open cash closing
 */
exports.openClosing = async (req, res) => {
  try {
    const { notes, initialCash } = req.body;
    const tenantId = req.user?.tenant;
    const userId = req.user?._id;

    if (!tenantId) {
      return sendError(res, {
        status: 401,
        code: "UNAUTHORIZED",
        message: "Tenant no identificado",
      });
    }

    const closing = await cashClosingService.createClosing(tenantId, userId, {
      notes,
      initialCash,
    });

    return res.status(201).json({
      success: true,
      message: "Cierre de caja abierto exitosamente",
      data: closing,
    });
  } catch (error) {
    return handleServerError(res, error, "Error al abrir cierre de caja");
  }
};

/**
 * POST /api/cash-closing/:id/close
 * Close an open cash closing with actual amounts
 */
exports.closeClosing = async (req, res) => {
  try {
    const { id: closingId } = req.params;
    const { actualAmounts, notes } = req.body;
    const tenantId = req.user?.tenant;
    const userId = req.user?._id;

    if (!tenantId) {
      return sendError(res, {
        status: 401,
        code: "UNAUTHORIZED",
        message: "Tenant no identificado",
      });
    }

    if (!actualAmounts || typeof actualAmounts !== "object") {
      return sendError(res, {
        status: 400,
        code: "INVALID_AMOUNTS",
        message: "Debe proporcionar los montos reales contados (actualAmounts)",
      });
    }

    const closing = await cashClosingService.closeClosing(
      closingId,
      actualAmounts,
      userId,
      { notes }
    );

    return res.status(200).json({
      success: true,
      message: "Cierre de caja cerrado exitosamente",
      data: closing,
    });
  } catch (error) {
    return handleServerError(res, error, "Error al cerrar cierre de caja");
  }
};

/**
 * POST /api/cash-closing/:id/reopen
 * Reopen a closed cash closing
 */
exports.reopenClosing = async (req, res) => {
  try {
    const { id: closingId } = req.params;
    const { reason } = req.body;
    const tenantId = req.user?.tenant;
    const userId = req.user?._id;

    if (!tenantId) {
      return sendError(res, {
        status: 401,
        code: "UNAUTHORIZED",
        message: "Tenant no identificado",
      });
    }

    if (!reason || reason.trim().length < 3) {
      return sendError(res, {
        status: 400,
        code: "REASON_REQUIRED",
        message: "Debe proporcionar un motivo para reabrir (mínimo 3 caracteres)",
      });
    }

    const closing = await cashClosingService.reopenClosing(
      closingId,
      reason,
      userId
    );

    return res.status(200).json({
      success: true,
      message: "Cierre de caja reabierto exitosamente",
      data: closing,
    });
  } catch (error) {
    return handleServerError(res, error, "Error al reabrir cierre de caja");
  }
};

/**
 * GET /api/cash-closing/current
 * Get the currently open cash closing
 */
exports.getCurrentClosing = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;

    if (!tenantId) {
      return sendError(res, {
        status: 401,
        code: "UNAUTHORIZED",
        message: "Tenant no identificado",
      });
    }

    const closing = await cashClosingService.getOpenClosing(tenantId);

    if (!closing) {
      return res.status(200).json({
        success: true,
        message: "No hay cierre de caja abierto",
        data: null,
      });
    }

    return res.status(200).json({
      success: true,
      data: closing,
    });
  } catch (error) {
    return handleServerError(res, error, "Error al obtener cierre de caja actual");
  }
};

/**
 * GET /api/cash-closing/preview
 * Get a preview of the current open cash closing with real-time data
 */
exports.getOpenClosingPreview = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;

    if (!tenantId) {
      return sendError(res, {
        status: 401,
        code: "UNAUTHORIZED",
        message: "Tenant no identificado",
      });
    }

    const preview = await cashClosingService.getOpenClosingPreview(tenantId);

    if (!preview) {
      return res.status(200).json({
        success: true,
        message: "No hay cierre de caja abierto",
        data: null,
      });
    }

    return res.status(200).json({
      success: true,
      data: preview,
    });
  } catch (error) {
    return handleServerError(res, error, "Error al obtener preview del cierre de caja");
  }
};

/**
 * GET /api/cash-closing/:id
 * Get a specific cash closing by ID
 */
exports.getClosingById = async (req, res) => {
  try {
    const { id: closingId } = req.params;
    const tenantId = req.user?.tenant;

    if (!tenantId) {
      return sendError(res, {
        status: 401,
        code: "UNAUTHORIZED",
        message: "Tenant no identificado",
      });
    }

    const closing = await cashClosingService.getClosingById(closingId, tenantId);

    return res.status(200).json({
      success: true,
      data: closing,
    });
  } catch (error) {
    return handleServerError(res, error, "Error al obtener cierre de caja");
  }
};

/**
 * GET /api/cash-closing
 * List cash closings with pagination and filters
 */
exports.listClosings = async (req, res) => {
  try {
    const { status, dateFrom, dateTo, page, limit } = req.query;
    const tenantId = req.user?.tenant;

    if (!tenantId) {
      return sendError(res, {
        status: 401,
        code: "UNAUTHORIZED",
        message: "Tenant no identificado",
      });
    }

    const filters = {};
    if (status) filters.status = status;
    if (dateFrom) filters.dateFrom = dateFrom;
    if (dateTo) filters.dateTo = dateTo;

    const pagination = {
      page: parseInt(page, 10) || 1,
      limit: parseInt(limit, 10) || 20,
    };

    const result = await cashClosingService.listClosings(
      tenantId,
      filters,
      pagination
    );

    return res.status(200).json({
      success: true,
      data: result.closings,
      pagination: result.pagination,
    });
  } catch (error) {
    return handleServerError(res, error, "Error al listar cierres de caja");
  }
};

/**
 * GET /api/cash-closing/:id/report
 * Get Z-Report for a closing
 */
exports.getZReport = async (req, res) => {
  try {
    const { id: closingId } = req.params;
    const tenantId = req.user?.tenant;

    if (!tenantId) {
      return sendError(res, {
        status: 401,
        code: "UNAUTHORIZED",
        message: "Tenant no identificado",
      });
    }

    const report = await cashClosingService.getZReport(closingId, tenantId);

    return res.status(200).json({
      success: true,
      data: report,
    });
  } catch (error) {
    return handleServerError(res, error, "Error al generar reporte Z");
  }
};
