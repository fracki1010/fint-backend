const mongoose = require("mongoose");
const path = require("path");
const Voucher = require("../models/voucher.model");
const VoucherCounter = require("../models/voucherCounter.model");
const Order = require("../models/order.model");
const Client = require("../models/client.model");
const Setting = require("../models/setting.model");
const { generateVoucherPdf, buildVoucherFilePath } = require("../utils/voucherPdf");
const { HttpError } = require("../utils/http");

// Default prefixes by voucher type
const DEFAULT_PREFIXES = {
  invoice: "F-",
  delivery_note: "R-",
  receipt: "D-",
};

/**
 * Gets or creates a voucher counter for a tenant/type/year combination
 * @param {string} tenantId - Tenant ObjectId
 * @param {string} type - Voucher type (invoice, delivery_note, receipt)
 * @param {number} year - Year (defaults to current)
 * @returns {Promise<Object>} VoucherCounter document
 */
const getOrCreateCounter = async (tenantId, type, year = new Date().getFullYear()) => {
  let counter = await VoucherCounter.findOne({
    tenant: tenantId,
    type,
    year,
  });

  if (!counter) {
    counter = await VoucherCounter.create({
      tenant: tenantId,
      type,
      year,
      prefix: DEFAULT_PREFIXES[type] || "DOC-",
      lastNumber: 0,
    });
  }

  return counter;
};

/**
 * Gets the next sequential number for a voucher type
 * Uses atomic findOneAndUpdate to prevent race conditions
 * @param {string} type - Voucher type
 * @param {string} tenantId - Tenant ObjectId
 * @returns {Promise<Object>} { prefix, sequentialNumber, fullNumber, year }
 */
const getNextNumber = async (type, tenantId) => {
  const currentYear = new Date().getFullYear();

  // Use atomic operation to increment counter
  const counter = await VoucherCounter.findOneAndUpdate(
    { tenant: tenantId, type, year: currentYear },
    [
      {
        $set: {
          // Reset counter if year changed
          lastNumber: {
            $cond: {
              if: { $eq: ["$year", currentYear] },
              then: { $add: ["$lastNumber", 1] },
              else: 1,
            },
          },
          year: currentYear,
          prefix: {
            $ifNull: ["$prefix", DEFAULT_PREFIXES[type] || "DOC-"],
          },
        },
      },
    ],
    {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true,
    },
  );

  const sequentialNumber = counter.lastNumber;
  const fullNumber = `${counter.prefix}${String(sequentialNumber).padStart(6, "0")}`;

  return {
    prefix: counter.prefix,
    sequentialNumber,
    fullNumber,
    year: currentYear,
  };
};

/**
 * Previews the next number without incrementing
 * @param {string} type - Voucher type
 * @param {string} tenantId - Tenant ObjectId
 * @returns {Promise<Object>} { prefix, sequentialNumber, fullNumber, year }
 */
const previewNextNumber = async (type, tenantId) => {
  const currentYear = new Date().getFullYear();
  const counter = await getOrCreateCounter(tenantId, type, currentYear);

  const nextNumber = counter.lastNumber + 1;
  const fullNumber = `${counter.prefix}${String(nextNumber).padStart(6, "0")}`;

  return {
    prefix: counter.prefix,
    sequentialNumber: nextNumber,
    fullNumber,
    year: currentYear,
  };
};

/**
 * Generates a single voucher
 * @param {string} orderId - Order ObjectId
 * @param {string} type - Voucher type
 * @param {string} userId - User ObjectId (creator)
 * @param {Object} options - Additional options
 * @returns {Promise<Object>} Generated voucher
 */
const generateVoucher = async (orderId, type, userId, options = {}) => {
  const { tenantId, skipIfExists = true } = options;

  if (!tenantId) {
    throw new HttpError(400, "TENANT_REQUIRED", "Tenant ID es requerido");
  }

  // Validate type
  const validTypes = ["invoice", "delivery_note", "receipt"];
  if (!validTypes.includes(type)) {
    throw new HttpError(400, "INVALID_VOUCHER_TYPE", `Tipo de comprobante inválido: ${type}`);
  }

  // Check if active voucher already exists for this order/type
  if (skipIfExists) {
    const existingVoucher = await Voucher.findOne({
      order: orderId,
      type,
      status: "active",
      tenant: tenantId,
    });

    if (existingVoucher) {
      return existingVoucher;
    }
  }

  // Fetch order with client
  const order = await Order.findOne({ _id: orderId, tenant: tenantId }).populate("client");
  if (!order) {
    throw new HttpError(404, "ORDER_NOT_FOUND", "Orden no encontrada");
  }

  // Fetch store settings
  const settings = await Setting.findOne({ tenant: tenantId });
  const store = {
    storeName: settings?.storeName || "Fint Guard",
    taxId: settings?.taxId || "",
    phone: settings?.phone || "",
    email: settings?.email || "",
    address: settings?.address || "",
    taxRate: settings?.taxRate || 21,
  };

  // Get client info
  const client = order.client || {};

  // Get next number
  const { fullNumber, sequentialNumber, year } = await getNextNumber(type, tenantId);

  // Build file path
  const { filePath } = buildVoucherFilePath({
    tenantId,
    type,
    number: fullNumber,
  });

  // Generate PDF
  await generateVoucherPdf({
    voucherType: type,
    voucherNumber: fullNumber,
    order,
    client,
    store,
    outputPath: filePath,
  });

  // Build file URL (relative)
  const fileUrl = `/api/vouchers/download/${path.basename(filePath)}`;

  // Create voucher record
  const voucher = await Voucher.create({
    tenant: tenantId,
    order: orderId,
    type,
    number: fullNumber,
    sequentialNumber,
    year,
    filePath,
    fileUrl,
    status: "active",
    createdBy: userId,
    metadata: {
      clientName: client.name || client.phone || "Consumidor final",
      clientTaxId: client.taxId || "",
      totalAmount: order.totalAmount || 0,
      itemCount: order.items?.length || 0,
    },
  });

  return voucher;
};

/**
 * Generates multiple vouchers for an order in parallel
 * @param {string} orderId - Order ObjectId
 * @param {string[]} types - Array of voucher types to generate
 * @param {string} userId - User ObjectId (creator)
 * @param {Object} options - Additional options
 * @returns {Promise<Object[]>} Array of generated vouchers
 */
const generateVouchers = async (orderId, types, userId, options = {}) => {
  if (!Array.isArray(types) || types.length === 0) {
    throw new HttpError(400, "INVALID_TYPES", "Debe especificar al menos un tipo de comprobante");
  }

  const validTypes = ["invoice", "delivery_note", "receipt"];
  const invalidTypes = types.filter((t) => !validTypes.includes(t));
  if (invalidTypes.length > 0) {
    throw new HttpError(400, "INVALID_VOUCHER_TYPES", `Tipos inválidos: ${invalidTypes.join(", ")}`);
  }

  // Generate all vouchers in parallel
  const voucherPromises = types.map((type) =>
    generateVoucher(orderId, type, userId, options).catch((error) => ({
      type,
      error: error.message,
      success: false,
    })),
  );

  const results = await Promise.all(voucherPromises);

  // Separate successful from failed
  const vouchers = results.filter((r) => !r.error);
  const errors = results.filter((r) => r.error);

  return {
    vouchers,
    errors: errors.length > 0 ? errors : null,
    totalRequested: types.length,
    totalGenerated: vouchers.length,
  };
};

/**
 * Voids (anulls) a voucher
 * Keeps the record and PDF for audit purposes
 * @param {string} voucherId - Voucher ObjectId
 * @param {string} reason - Reason for voiding
 * @param {string} userId - User ObjectId (who voids)
 * @returns {Promise<Object>} Updated voucher
 */
const voidVoucher = async (voucherId, reason, userId) => {
  if (!reason || reason.trim().length < 3) {
    throw new HttpError(400, "VOID_REASON_REQUIRED", "Debe proporcionar un motivo de anulación (mínimo 3 caracteres)");
  }

  const voucher = await Voucher.findById(voucherId);
  if (!voucher) {
    throw new HttpError(404, "VOUCHER_NOT_FOUND", "Comprobante no encontrado");
  }

  if (voucher.status === "voided") {
    throw new HttpError(400, "ALREADY_VOIDED", "El comprobante ya está anulado");
  }

  voucher.status = "voided";
  voucher.voidReason = reason.trim();
  voucher.voidedAt = new Date();
  await voucher.save();

  return voucher;
};

/**
 * Gets all vouchers for an order
 * @param {string} orderId - Order ObjectId
 * @param {Object} options - Query options
 * @returns {Promise<Object[]>} Array of vouchers
 */
const getVouchersByOrder = async (orderId, options = {}) => {
  const { includeVoided = false, tenantId } = options;

  const query = { order: orderId };
  if (!includeVoided) {
    query.status = "active";
  }
  if (tenantId) {
    query.tenant = tenantId;
  }

  const vouchers = await Voucher.find(query)
    .sort({ createdAt: -1 })
    .populate("createdBy", "fullName email")
    .lean();

  return vouchers;
};

/**
 * Gets a single voucher by ID
 * @param {string} voucherId - Voucher ObjectId
 * @param {string} tenantId - Tenant ObjectId (for security)
 * @returns {Promise<Object>} Voucher document
 */
const getVoucherById = async (voucherId, tenantId) => {
  const query = { _id: voucherId };
  if (tenantId) {
    query.tenant = tenantId;
  }

  const voucher = await Voucher.findOne(query)
    .populate("order", "orderNumber totalAmount items")
    .populate("createdBy", "fullName email")
    .populate("tenant", "name");

  if (!voucher) {
    throw new HttpError(404, "VOUCHER_NOT_FOUND", "Comprobante no encontrado");
  }

  return voucher;
};

/**
 * Lists vouchers with filtering and pagination
 * @param {Object} filters - Filter criteria
 * @param {Object} pagination - Pagination options
 * @returns {Promise<Object>} { vouchers, total, page, totalPages }
 */
const listVouchers = async (filters = {}, pagination = {}) => {
  const {
    tenantId,
    type,
    status,
    orderId,
    clientName,
    dateFrom,
    dateTo,
  } = filters;

  const { page = 1, limit = 20 } = pagination;

  const query = {};

  if (tenantId) query.tenant = tenantId;
  if (type) query.type = type;
  if (status) query.status = status;
  if (orderId) query.order = orderId;
  if (clientName) {
    query["metadata.clientName"] = { $regex: clientName, $options: "i" };
  }

  if (dateFrom || dateTo) {
    query.createdAt = {};
    if (dateFrom) query.createdAt.$gte = new Date(dateFrom);
    if (dateTo) query.createdAt.$lte = new Date(dateTo);
  }

  const skip = (Math.max(1, page) - 1) * Math.min(100, Math.max(1, limit));
  const pageSize = Math.min(100, Math.max(1, limit));

  const [vouchers, total] = await Promise.all([
    Voucher.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(pageSize)
      .populate("order", "orderNumber totalAmount")
      .populate("createdBy", "fullName")
      .lean(),
    Voucher.countDocuments(query),
  ]);

  return {
    vouchers,
    total,
    page: Math.max(1, page),
    totalPages: Math.ceil(total / pageSize),
    hasNextPage: skip + vouchers.length < total,
  };
};

/**
 * Gets the absolute file path for streaming
 * @param {string} voucherId - Voucher ObjectId
 * @param {string} tenantId - Tenant ObjectId (for security)
 * @returns {Promise<string>} Absolute file path
 */
const getVoucherFilePath = async (voucherId, tenantId) => {
  const query = { _id: voucherId };
  if (tenantId) {
    query.tenant = tenantId;
  }

  const voucher = await Voucher.findOne(query).select("filePath status");

  if (!voucher) {
    throw new HttpError(404, "VOUCHER_NOT_FOUND", "Comprobante no encontrado");
  }

  return voucher.filePath;
};

module.exports = {
  // Core generation
  generateVoucher,
  generateVouchers,
  getNextNumber,
  previewNextNumber,

  // Management
  voidVoucher,
  getVoucherById,
  getVouchersByOrder,
  listVouchers,
  getVoucherFilePath,

  // Utilities
  getOrCreateCounter,
};
