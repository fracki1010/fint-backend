const mongoose = require("mongoose");
const voucherService = require("../services/voucherService");
const fs = require("fs");
const path = require("path");
const { HttpError, sendError, handleServerError } = require("../utils/http");

// Valid voucher types
const VALID_TYPES = ["invoice", "delivery_note", "receipt"];

/**
 * POST /orders/:id/vouchers
 * Generate vouchers for an order (batch)
 */
exports.generateVouchersForOrder = async (req, res) => {
  try {
    const { id: orderId } = req.params;
    const { types, generateOnCreate } = req.body;
    const tenantId = req.user?.tenant;
    const userId = req.user?._id;

    if (!tenantId) {
      return sendError(res, {
        status: 401,
        code: "UNAUTHORIZED",
        message: "Tenant no identificado",
      });
    }

    // Support both explicit types array and flag for order creation
    let voucherTypes = types;
    if (generateOnCreate && (!types || types.length === 0)) {
      // Default to invoice if generateOnCreate is true but no types specified
      voucherTypes = ["invoice"];
    }

    if (!Array.isArray(voucherTypes) || voucherTypes.length === 0) {
      return sendError(res, {
        status: 400,
        code: "TYPES_REQUIRED",
        message: "Debe especificar al menos un tipo de comprobante (types: string[])",
      });
    }

    // Validate types
    const invalidTypes = voucherTypes.filter((t) => !VALID_TYPES.includes(t));
    if (invalidTypes.length > 0) {
      return sendError(res, {
        status: 400,
        code: "INVALID_TYPES",
        message: `Tipos inválidos: ${invalidTypes.join(", ")}. Válidos: ${VALID_TYPES.join(", ")}`,
      });
    }

    const result = await voucherService.generateVouchers(orderId, voucherTypes, userId, {
      tenantId,
      skipIfExists: true,
    });

    // Return appropriate status based on results
    const statusCode = result.errors && result.errors.length === result.totalRequested ? 207 : 201;

    return res.status(statusCode).json({
      success: result.totalGenerated > 0,
      message: `Generados ${result.totalGenerated} de ${result.totalRequested} comprobantes`,
      data: result,
    });
  } catch (error) {
    return handleServerError(res, error, "Error al generar comprobantes");
  }
};

/**
 * GET /orders/:id/vouchers
 * List all vouchers for an order
 */
exports.getVouchersByOrder = async (req, res) => {
  try {
    const { id: orderId } = req.params;
    const { includeVoided } = req.query;
    const tenantId = req.user?.tenant;

    if (!tenantId) {
      return sendError(res, {
        status: 401,
        code: "UNAUTHORIZED",
        message: "Tenant no identificado",
      });
    }

    const vouchers = await voucherService.getVouchersByOrder(orderId, {
      includeVoided: includeVoided === "true",
      tenantId,
    });

    return res.json({
      success: true,
      count: vouchers.length,
      vouchers: vouchers,
    });
  } catch (error) {
    return handleServerError(res, error, "Error al obtener comprobantes");
  }
};

/**
 * POST /vouchers
 * Generate a single voucher
 */
exports.createVoucher = async (req, res) => {
  try {
    const { orderId, type } = req.body;
    const tenantId = req.user?.tenant;
    const userId = req.user?._id;

    if (!tenantId) {
      return sendError(res, {
        status: 401,
        code: "UNAUTHORIZED",
        message: "Tenant no identificado",
      });
    }

    if (!orderId || !type) {
      return sendError(res, {
        status: 400,
        code: "MISSING_FIELDS",
        message: "orderId y type son requeridos",
      });
    }

    if (!VALID_TYPES.includes(type)) {
      return sendError(res, {
        status: 400,
        code: "INVALID_TYPE",
        message: `Tipo inválido. Válidos: ${VALID_TYPES.join(", ")}`,
      });
    }

    const voucher = await voucherService.generateVoucher(orderId, type, userId, {
      tenantId,
      skipIfExists: false,
    });

    return res.status(201).json({
      success: true,
      message: "Comprobante generado exitosamente",
      data: voucher,
    });
  } catch (error) {
    return handleServerError(res, error, "Error al generar comprobante");
  }
};

/**
 * GET /vouchers
 * List all vouchers with filtering
 */
exports.listVouchers = async (req, res) => {
  try {
    const {
      type,
      status,
      orderId,
      clientName,
      dateFrom,
      dateTo,
      page,
      limit,
    } = req.query;
    const tenantId = req.user?.tenant;

    if (!tenantId) {
      return sendError(res, {
        status: 401,
        code: "UNAUTHORIZED",
        message: "Tenant no identificado",
      });
    }

    const result = await voucherService.listVouchers(
      {
        tenantId,
        type,
        status,
        orderId,
        clientName,
        dateFrom,
        dateTo,
      },
      {
        page: page ? parseInt(page, 10) : 1,
        limit: limit ? parseInt(limit, 10) : 20,
      },
    );

    return res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    return handleServerError(res, error, "Error al listar comprobantes");
  }
};

/**
 * GET /vouchers/:id
 * Get a single voucher by ID
 */
exports.getVoucherById = async (req, res) => {
  try {
    const { id } = req.params;
    const tenantId = req.user?.tenant;

    if (!tenantId) {
      return sendError(res, {
        status: 401,
        code: "UNAUTHORIZED",
        message: "Tenant no identificado",
      });
    }

    const voucher = await voucherService.getVoucherById(id, tenantId);

    return res.json({
      success: true,
      data: voucher,
    });
  } catch (error) {
    return handleServerError(res, error, "Error al obtener comprobante");
  }
};

/**
 * GET /vouchers/:id/download
 * Download voucher PDF
 */
exports.downloadVoucher = async (req, res) => {
  try {
    const { id } = req.params;
    const tenantId = req.user?.tenant;

    if (!tenantId) {
      return sendError(res, {
        status: 401,
        code: "UNAUTHORIZED",
        message: "Tenant no identificado",
      });
    }

    const filePath = await voucherService.getVoucherFilePath(id, tenantId);

    // Check if file exists
    if (!fs.existsSync(filePath)) {
      return sendError(res, {
        status: 404,
        code: "FILE_NOT_FOUND",
        message: "Archivo PDF no encontrado",
      });
    }

    // Get filename from path
    const fileName = path.basename(filePath);

    // Set headers for download
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);

    // Stream file
    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);

    fileStream.on("error", (error) => {
      console.error("Error streaming PDF:", error);
      if (!res.headersSent) {
        sendError(res, {
          status: 500,
          code: "STREAM_ERROR",
          message: "Error al transmitir el archivo",
        });
      }
    });
  } catch (error) {
    return handleServerError(res, error, "Error al descargar comprobante");
  }
};

/**
 * POST /vouchers/:id/void
 * Void (anull) a voucher
 */
exports.voidVoucher = async (req, res) => {
  try {
    const { id } = req.params;
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
        message: "Debe proporcionar un motivo de anulación (mínimo 3 caracteres)",
      });
    }

    const voucher = await voucherService.voidVoucher(id, reason, userId);

    return res.json({
      success: true,
      message: "Comprobante anulado exitosamente",
      data: voucher,
    });
  } catch (error) {
    return handleServerError(res, error, "Error al anular comprobante");
  }
};

/**
 * GET /vouchers/next-number/:type
 * Preview the next voucher number without generating
 */
exports.previewNextNumber = async (req, res) => {
  try {
    const { type } = req.params;
    const tenantId = req.user?.tenant;

    if (!tenantId) {
      return sendError(res, {
        status: 401,
        code: "UNAUTHORIZED",
        message: "Tenant no identificado",
      });
    }

    if (!VALID_TYPES.includes(type)) {
      return sendError(res, {
        status: 400,
        code: "INVALID_TYPE",
        message: `Tipo inválido. Válidos: ${VALID_TYPES.join(", ")}`,
      });
    }

    const preview = await voucherService.previewNextNumber(type, tenantId);

    return res.json({
      success: true,
      data: preview,
    });
  } catch (error) {
    return handleServerError(res, error, "Error al obtener próximo número");
  }
};
