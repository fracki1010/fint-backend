const BankTransaction = require("../models/bankTransaction.model");
const BankAccount = require("../models/bankAccount.model");
const csvImportService = require("../services/csvImportService");
const { sendError, handleServerError } = require("../utils/http");

const VALID_STATUS_TRANSITIONS = {
  pending: ["cleared"],
  cleared: ["pending", "reconciled"],
  reconciled: [],
};

/**
 * GET /api/banking/transactions
 * List bank transactions with filters
 */
exports.listTransactions = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;

    if (!tenantId) {
      return sendError(res, {
        status: 401,
        code: "UNAUTHORIZED",
        message: "Tenant no identificado",
      });
    }

    const { bankAccount, dateFrom, dateTo, status, type } = req.query;
    const filter = { tenant: tenantId };

    if (bankAccount) filter.bankAccount = bankAccount;
    if (status) filter.status = status;
    if (type) filter.type = type;
    if (dateFrom || dateTo) {
      filter.date = {};
      if (dateFrom) filter.date.$gte = new Date(dateFrom);
      if (dateTo) filter.date.$lte = new Date(dateTo);
    }

    const transactions = await BankTransaction.find(filter)
      .populate("bankAccount", "name bank accountNumber")
      .sort({ date: -1 });

    return res.json({ success: true, data: transactions });
  } catch (error) {
    return handleServerError(res, error, "Error al obtener transacciones bancarias");
  }
};

/**
 * GET /api/banking/transactions/:id
 * Get a single transaction
 */
exports.getTransaction = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;

    if (!tenantId) {
      return sendError(res, {
        status: 401,
        code: "UNAUTHORIZED",
        message: "Tenant no identificado",
      });
    }

    const transaction = await BankTransaction.findOne({
      _id: req.params.id,
      tenant: tenantId,
    }).populate("bankAccount", "name bank accountNumber");

    if (!transaction) {
      return sendError(res, {
        status: 404,
        code: "NOT_FOUND",
        message: "Transacción no encontrada",
      });
    }

    return res.json({ success: true, data: transaction });
  } catch (error) {
    return handleServerError(res, error, "Error al obtener transacción bancaria");
  }
};

/**
 * POST /api/banking/transactions
 * Create a new bank transaction (manual entry)
 */
exports.createTransaction = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;

    if (!tenantId) {
      return sendError(res, {
        status: 401,
        code: "UNAUTHORIZED",
        message: "Tenant no identificado",
      });
    }

    const { bankAccount, date, description, amount, type, reference, notes } =
      req.body;

    // Verify the bank account belongs to this tenant
    const account = await BankAccount.findOne({
      _id: bankAccount,
      tenant: tenantId,
    });

    if (!account) {
      return sendError(res, {
        status: 404,
        code: "NOT_FOUND",
        message: "Cuenta bancaria no encontrada",
      });
    }

    const transaction = await BankTransaction.create({
      tenant: tenantId,
      bankAccount,
      date: new Date(date),
      description,
      amount,
      type,
      reference,
      notes,
      status: "pending",
    });

    return res.status(201).json({
      success: true,
      message: "Transacción creada exitosamente",
      data: transaction,
    });
  } catch (error) {
    return handleServerError(res, error, "Error al crear transacción bancaria");
  }
};

/**
 * PUT /api/banking/transactions/:id
 * Update a transaction (including status transitions)
 */
exports.updateTransaction = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;

    if (!tenantId) {
      return sendError(res, {
        status: 401,
        code: "UNAUTHORIZED",
        message: "Tenant no identificado",
      });
    }

    const transaction = await BankTransaction.findOne({
      _id: req.params.id,
      tenant: tenantId,
    });

    if (!transaction) {
      return sendError(res, {
        status: 404,
        code: "NOT_FOUND",
        message: "Transacción no encontrada",
      });
    }

    // Handle status transitions
    if (req.body.status && req.body.status !== transaction.status) {
      const allowedTransitions = VALID_STATUS_TRANSITIONS[transaction.status] || [];

      if (!allowedTransitions.includes(req.body.status)) {
        return sendError(res, {
          status: 400,
          code: "INVALID_TRANSITION",
          message: `No se puede cambiar de "${transaction.status}" a "${req.body.status}". Transiciones permitidas: ${allowedTransitions.join(", ") || "ninguna"}`,
        });
      }

      // If transitioning to reconciled, require matched fields
      if (req.body.status === "reconciled") {
        const matchedEntryType =
          req.body.matchedEntryType || transaction.matchedEntryType;
        const matchedEntryId =
          req.body.matchedEntryId || transaction.matchedEntryId;

        if (!matchedEntryType || !matchedEntryId) {
          return sendError(res, {
            status: 400,
            code: "MATCH_REQUIRED",
            message:
              "Para reconciliar una transacción debe proporcionar matchedEntryType y matchedEntryId",
          });
        }
      }
    }

    // Apply updates
    const allowedFields = [
      "date",
      "description",
      "amount",
      "type",
      "reference",
      "status",
      "notes",
    ];
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        transaction[field] = req.body[field];
      }
    }

    // Parse date if provided
    if (req.body.date) {
      transaction.date = new Date(req.body.date);
    }

    // Set reconciliation date when status changes to reconciled
    if (req.body.status === "reconciled" && transaction.isModified("status")) {
      transaction.reconciliationDate = new Date();
    }

    await transaction.save();

    return res.json({
      success: true,
      message: "Transacción actualizada exitosamente",
      data: transaction,
    });
  } catch (error) {
    return handleServerError(res, error, "Error al actualizar transacción bancaria");
  }
};

/**
 * POST /api/banking/accounts/:id/import-preview
 * Parse a CSV file and return a preview (no insertion)
 */
exports.previewCsv = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;

    if (!tenantId) {
      return sendError(res, {
        status: 401,
        code: "UNAUTHORIZED",
        message: "Tenant no identificado",
      });
    }

    // Validate file was uploaded
    if (!req.file) {
      return sendError(res, {
        status: 400,
        code: "UPLOAD_ERROR",
        message: "Debe adjuntar un archivo CSV",
      });
    }

    // Validate file type
    const isCSV =
      req.file.mimetype === "text/csv" ||
      req.file.mimetype === "application/vnd.ms-excel" ||
      req.file.originalname.toLowerCase().endsWith(".csv");

    if (!isCSV) {
      return sendError(res, {
        status: 400,
        code: "UPLOAD_ERROR",
        message: "El archivo debe ser un CSV válido",
      });
    }

    const preview = csvImportService.parseCSV(req.file.buffer);

    return res.json({
      success: true,
      data: preview,
    });
  } catch (error) {
    if (error.status === 400) {
      return sendError(res, {
        status: error.status,
        code: error.code || "UPLOAD_ERROR",
        message: error.message,
      });
    }
    return handleServerError(res, error, "Error al procesar el archivo CSV");
  }
};

/**
 * POST /api/banking/accounts/:id/import
 * Parse a CSV file and bulk insert valid rows
 */
exports.importCsv = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;

    if (!tenantId) {
      return sendError(res, {
        status: 401,
        code: "UNAUTHORIZED",
        message: "Tenant no identificado",
      });
    }

    // Validate file
    if (!req.file) {
      return sendError(res, {
        status: 400,
        code: "UPLOAD_ERROR",
        message: "Debe adjuntar un archivo CSV",
      });
    }

    const isCSV =
      req.file.mimetype === "text/csv" ||
      req.file.mimetype === "application/vnd.ms-excel" ||
      req.file.originalname.toLowerCase().endsWith(".csv");

    if (!isCSV) {
      return sendError(res, {
        status: 400,
        code: "UPLOAD_ERROR",
        message: "El archivo debe ser un CSV válido",
      });
    }

    // Verify the bank account exists and belongs to this tenant
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

    // Parse CSV
    const preview = csvImportService.parseCSV(req.file.buffer);

    // If no valid rows, return early
    if (preview.validRows.length === 0) {
      return res.json({
        success: true,
        data: {
          created: 0,
          errors: preview.errorRows,
          totalRows: preview.totalRows,
          detectedBank: preview.detectedBank,
          message: "No se encontraron filas válidas para importar",
        },
      });
    }

    // Bulk insert valid rows
    const created = await csvImportService.bulkInsertTransactions(
      tenantId,
      req.params.id,
      preview.validRows,
    );

    return res.json({
      success: true,
      data: {
        created,
        errors: preview.errorRows,
        totalRows: preview.totalRows,
        detectedBank: preview.detectedBank,
        message: `Se importaron ${created} transacciones correctamente${
          preview.errorRows.length > 0
            ? `. ${preview.errorRows.length} filas con errores fueron omitidas.`
            : ""
        }`,
      },
    });
  } catch (error) {
    if (error.status === 400) {
      return sendError(res, {
        status: error.status,
        code: error.code || "UPLOAD_ERROR",
        message: error.message,
      });
    }
    return handleServerError(res, error, "Error al importar el archivo CSV");
  }
};
