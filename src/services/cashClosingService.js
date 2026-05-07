const mongoose = require("mongoose");
const CashClosing = require("../models/cashClosing.model");
const Order = require("../models/order.model");
const ClientAccountEntry = require("../models/clientAccountEntry.model");
const { HttpError } = require("../utils/http");
const { logError } = require("../utils/logger");

// Default prefix for closing numbers
const CLOSING_PREFIX = "CJ-";

/**
 * Generates the next sequential closing number for a tenant
 * @param {string} tenantId - Tenant ObjectId
 * @returns {Promise<string>} Next closing number (e.g., "CJ-000001")
 */
const generateClosingNumber = async (tenantId) => {
  const lastClosing = await CashClosing.findOne({ tenant: tenantId })
    .sort({ createdAt: -1 })
    .select("closingNumber");

  let nextNumber = 1;
  if (lastClosing && lastClosing.closingNumber) {
    const match = lastClosing.closingNumber.match(/(\d+)$/);
    if (match) {
      nextNumber = parseInt(match[1], 10) + 1;
    }
  }

  return `${CLOSING_PREFIX}${String(nextNumber).padStart(6, "0")}`;
};

/**
 * Creates a new open cash closing
 * @param {string} tenantId - Tenant ObjectId
 * @param {string} userId - User ObjectId (opener)
 * @param {Object} options - Optional settings
 * @returns {Promise<Object>} Created cash closing
 */
const createClosing = async (tenantId, userId, options = {}) => {
  // Check if there's already an open closing
  const existingOpen = await CashClosing.findOne({
    tenant: tenantId,
    status: "open",
  });

  if (existingOpen) {
    throw new HttpError(
      400,
      "OPEN_CLOSING_EXISTS",
      "Ya existe un cierre de caja abierto. Debe cerrarlo antes de abrir uno nuevo."
    );
  }

  const closingNumber = await generateClosingNumber(tenantId);

  const closing = await CashClosing.create({
    tenant: tenantId,
    closingNumber,
    openedBy: userId,
    status: "open",
    openedAt: options.openedAt || new Date(),
    notes: options.notes || null,
  });

  return closing;
};

/**
 * Gets the currently open cash closing for a tenant
 * @param {string} tenantId - Tenant ObjectId
 * @returns {Promise<Object|null>} Open cash closing or null
 */
const getOpenClosing = async (tenantId) => {
  return CashClosing.findOne({
    tenant: tenantId,
    status: "open",
  }).populate("openedBy", "fullName email");
};

/**
 * Calculates expected totals from orders since opening
 * @param {string} closingId - CashClosing ObjectId
 * @param {Date} openedAt - Opening timestamp
 * @param {string} tenantId - Tenant ObjectId
 * @returns {Promise<Object>} Expected totals by payment method
 */
const calculateExpectedTotals = async (closingId, openedAt, tenantId) => {
  // Log for debugging
  logError("cash_closing_debug", {
    message: "Calculating expected totals",
    closingId: closingId?.toString(),
    openedAt: openedAt?.toISOString(),
    tenantId: tenantId?.toString(),
  });

  // Find orders created after opening that are paid or partial
  const orders = await Order.find({
    tenant: tenantId,
    createdAt: { $gte: openedAt },
    $or: [
      { paymentStatus: "Pagado" },
      { paymentStatus: "Parcial" },
    ],
  }).select("_id totalAmount paymentStatus");

  logError("cash_closing_debug", {
    message: `Found ${orders.length} orders`,
    orderIds: orders.map((o) => o._id.toString()),
    orderDetails: orders.map((o) => ({ id: o._id.toString(), total: o.totalAmount, status: o.paymentStatus })),
  });

  if (orders.length === 0) {
    return {
      cash: 0,
      card: 0,
      transfer: 0,
      check: 0,
      other: 0,
      total: 0,
      orderCount: 0,
      totalSales: 0,
    };
  }

  const orderIds = orders.map((o) => o._id);

  // Get payment entries for these orders
  const payments = await ClientAccountEntry.find({
    tenant: tenantId,
    order: { $in: orderIds },
    type: "PAYMENT",
  }).select("amount paymentMethod order");

  logError("cash_closing_debug", {
    message: `Found ${payments.length} payments`,
    payments: payments.map((p) => ({ order: p.order?.toString(), amount: p.amount, method: p.paymentMethod })),
  });

  // Aggregate by payment method
  const totals = {
    cash: 0,
    card: 0,
    transfer: 0,
    check: 0,
    other: 0,
    total: 0,
  };

  payments.forEach((payment) => {
    const method = payment.paymentMethod || "other";
    const amount = payment.amount || 0;

    if (totals[method] !== undefined) {
      totals[method] += amount;
    } else {
      totals.other += amount;
    }
    totals.total += amount;
  });

  // Calculate total sales from orders (not just payments)
  const totalSales = orders.reduce((sum, order) => sum + (order.totalAmount || 0), 0);

  const result = {
    ...totals,
    orderCount: orders.length,
    totalSales,
  };

  logError("cash_closing_debug", {
    message: "Calculation result",
    result,
  });

  return result;
};

/**
 * Closes a cash closing with actual amounts
 * @param {string} closingId - CashClosing ObjectId
 * @param {Object} actualAmounts - Actual counted amounts by payment method
 * @param {string} userId - User ObjectId (closer)
 * @param {Object} options - Optional settings (notes)
 * @returns {Promise<Object>} Closed cash closing
 */
const closeClosing = async (closingId, actualAmounts, userId, options = {}) => {
  const closing = await CashClosing.findOne({
    _id: closingId,
    status: "open",
  });

  if (!closing) {
    throw new HttpError(404, "CLOSING_NOT_FOUND", "Cierre de caja no encontrado o ya está cerrado");
  }

  // Calculate expected totals
  const expected = await calculateExpectedTotals(
    closingId,
    closing.openedAt,
    closing.tenant
  );

  // Extract actual amounts
  const {
    cash: actualCash = 0,
    card: actualCard = 0,
    transfer: actualTransfer = 0,
    check: actualCheck = 0,
    other: actualOther = 0,
  } = actualAmounts;

  const actualTotal = actualCash + actualCard + actualTransfer + actualCheck + actualOther;

  // Calculate discrepancies
  const discrepancyCash = actualCash - expected.cash;
  const discrepancyTotal = actualTotal - expected.total;

  // Update closing
  closing.status = "closed";
  closing.closedAt = new Date();
  closing.closedBy = userId;

  closing.expectedCash = expected.cash;
  closing.expectedCard = expected.card;
  closing.expectedTransfer = expected.transfer;
  closing.expectedCheck = expected.check;
  closing.expectedOther = expected.other;
  closing.expectedTotal = expected.total;

  closing.actualCash = actualCash;
  closing.actualCard = actualCard;
  closing.actualTransfer = actualTransfer;
  closing.actualCheck = actualCheck;
  closing.actualOther = actualOther;
  closing.actualTotal = actualTotal;

  closing.discrepancyCash = discrepancyCash;
  closing.discrepancyTotal = discrepancyTotal;

  closing.orderCount = expected.orderCount;
  closing.totalSales = expected.totalSales;
  closing.netSales = expected.total; // Net = payments received

  closing.notes = options.notes || closing.notes;

  await closing.save();

  // Link orders to this closing
  await Order.updateMany(
    {
      tenant: closing.tenant,
      createdAt: { $gte: closing.openedAt },
      cashClosing: null,
    },
    { cashClosing: closingId }
  );

  return closing;
};

/**
 * Reopens a closed cash closing (for corrections)
 * @param {string} closingId - CashClosing ObjectId
 * @param {string} reason - Reason for reopening
 * @param {string} userId - User ObjectId (reopener)
 * @returns {Promise<Object>} Reopened cash closing
 */
const reopenClosing = async (closingId, reason, userId) => {
  if (!reason || reason.trim().length < 3) {
    throw new HttpError(
      400,
      "REOPEN_REASON_REQUIRED",
      "Debe proporcionar un motivo para reabrir el cierre (mínimo 3 caracteres)"
    );
  }

  const closing = await CashClosing.findOne({
    _id: closingId,
    status: "closed",
  });

  if (!closing) {
    throw new HttpError(
      404,
      "CLOSING_NOT_FOUND",
      "Cierre de caja no encontrado o no está cerrado"
    );
  }

  // Mark as reopened
  closing.status = "reopened";
  closing.reopenedAt = new Date();
  closing.reopenedBy = userId;
  closing.reopenReason = reason;

  await closing.save();

  // Unlink orders from this closing
  await Order.updateMany(
    { cashClosing: closingId },
    { cashClosing: null }
  );

  return closing;
};

/**
 * Gets a single cash closing by ID
 * @param {string} closingId - CashClosing ObjectId
 * @param {string} tenantId - Tenant ObjectId (for security)
 * @returns {Promise<Object>} Cash closing with populated fields
 */
const getClosingById = async (closingId, tenantId) => {
  const closing = await CashClosing.findOne({
    _id: closingId,
    tenant: tenantId,
  })
    .populate("openedBy", "fullName email")
    .populate("closedBy", "fullName email")
    .populate("reopenedBy", "fullName email");

  if (!closing) {
    throw new HttpError(404, "CLOSING_NOT_FOUND", "Cierre de caja no encontrado");
  }

  return closing;
};

/**
 * Lists cash closings for a tenant with pagination
 * @param {string} tenantId - Tenant ObjectId
 * @param {Object} filters - Filter options (status, dateFrom, dateTo)
 * @param {Object} pagination - Pagination options (page, limit)
 * @returns {Promise<Object>} List of closings with pagination info
 */
const listClosings = async (tenantId, filters = {}, pagination = {}) => {
  const { status, dateFrom, dateTo } = filters;
  const { page = 1, limit = 20 } = pagination;

  const query = { tenant: tenantId };

  if (status) {
    query.status = status;
  }

  if (dateFrom || dateTo) {
    query.openedAt = {};
    if (dateFrom) {
      query.openedAt.$gte = new Date(dateFrom);
    }
    if (dateTo) {
      query.openedAt.$lte = new Date(dateTo);
    }
  }

  const skip = (page - 1) * limit;

  const [closings, total] = await Promise.all([
    CashClosing.find(query)
      .populate("openedBy", "fullName email")
      .populate("closedBy", "fullName email")
      .sort({ openedAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    CashClosing.countDocuments(query),
  ]);

  return {
    closings,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
  };
};

/**
 * Gets the Z-Report data for a closing
 * @param {string} closingId - CashClosing ObjectId
 * @param {string} tenantId - Tenant ObjectId
 * @returns {Promise<Object>} Z-Report data with breakdowns
 */
const getZReport = async (closingId, tenantId) => {
  const closing = await getClosingById(closingId, tenantId);

  // Get orders for this closing
  const orders = await Order.find({
    tenant: tenantId,
    cashClosing: closingId,
  })
    .populate("client", "name phone")
    .sort({ createdAt: 1 })
    .lean();

  // Get payment breakdown
  const orderIds = orders.map((o) => o._id);
  const payments = await ClientAccountEntry.find({
    tenant: tenantId,
    order: { $in: orderIds },
    type: "PAYMENT",
  }).select("amount paymentMethod createdAt");

  // Payment method breakdown
  const paymentBreakdown = {
    cash: { count: 0, amount: 0 },
    card: { count: 0, amount: 0 },
    transfer: { count: 0, amount: 0 },
    check: { count: 0, amount: 0 },
    other: { count: 0, amount: 0 },
  };

  payments.forEach((payment) => {
    const method = payment.paymentMethod || "other";
    if (paymentBreakdown[method]) {
      paymentBreakdown[method].count += 1;
      paymentBreakdown[method].amount += payment.amount || 0;
    } else {
      paymentBreakdown.other.count += 1;
      paymentBreakdown.other.amount += payment.amount || 0;
    }
  });

  // Hourly breakdown
  const hourlyMap = new Map();
  orders.forEach((order) => {
    const hour = new Date(order.createdAt).getHours();
    const hourKey = `${String(hour).padStart(2, "0")}:00`;

    if (!hourlyMap.has(hourKey)) {
      hourlyMap.set(hourKey, { hour: hourKey, orders: 0, amount: 0 });
    }

    const hourData = hourlyMap.get(hourKey);
    hourData.orders += 1;
    hourData.amount += order.totalAmount || 0;
  });

  const hourlyBreakdown = Array.from(hourlyMap.values()).sort((a, b) =>
    a.hour.localeCompare(b.hour)
  );

  return {
    closing,
    orders: orders.map((o) => ({
      _id: o._id,
      orderNumber: o.orderNumber,
      client: o.client,
      totalAmount: o.totalAmount,
      paymentStatus: o.paymentStatus,
      createdAt: o.createdAt,
    })),
    paymentBreakdown,
    hourlyBreakdown,
    summary: {
      totalOrders: orders.length,
      totalSales: closing.totalSales,
      netSales: closing.netSales,
      expectedTotal: closing.expectedTotal,
      actualTotal: closing.actualTotal,
      discrepancy: closing.discrepancyTotal,
    },
  };
};

/**
 * Gets a preview of the current open cash closing with real-time data
 * Used to show sales accumulating while the cash register is open
 * @param {string} tenantId - Tenant ObjectId
 * @returns {Promise<Object>} Preview data with orders and totals
 */
const getOpenClosingPreview = async (tenantId) => {
  const closing = await getOpenClosing(tenantId);
  
  if (!closing) {
    return null;
  }

  // Get orders created after opening
  const orders = await Order.find({
    tenant: tenantId,
    createdAt: { $gte: closing.openedAt },
  })
    .populate("client", "name phone")
    .sort({ createdAt: -1 })
    .lean();

  // Calculate payment breakdown from ClientAccountEntry
  const orderIds = orders.map((o) => o._id);
  const payments = await ClientAccountEntry.find({
    tenant: tenantId,
    order: { $in: orderIds },
    type: "PAYMENT",
  }).select("amount paymentMethod order");

  // Aggregate by payment method
  const paymentBreakdown = {
    cash: { count: 0, amount: 0 },
    card: { count: 0, amount: 0 },
    transfer: { count: 0, amount: 0 },
    check: { count: 0, amount: 0 },
    other: { count: 0, amount: 0 },
  };

  payments.forEach((payment) => {
    const method = payment.paymentMethod || "other";
    if (paymentBreakdown[method]) {
      paymentBreakdown[method].count += 1;
      paymentBreakdown[method].amount += payment.amount || 0;
    } else {
      paymentBreakdown.other.count += 1;
      paymentBreakdown.other.amount += payment.amount || 0;
    }
  });

  // Calculate hourly breakdown
  const hourlyMap = new Map();
  orders.forEach((order) => {
    const hour = new Date(order.createdAt).getHours();
    const hourKey = `${String(hour).padStart(2, "0")}:00`;

    if (!hourlyMap.has(hourKey)) {
      hourlyMap.set(hourKey, { hour: hourKey, orders: 0, amount: 0 });
    }

    const hourData = hourlyMap.get(hourKey);
    hourData.orders += 1;
    hourData.amount += order.totalAmount || 0;
  });

  const hourlyBreakdown = Array.from(hourlyMap.values()).sort((a, b) =>
    a.hour.localeCompare(b.hour)
  );

  // Calculate totals
  const totalSales = orders.reduce((sum, order) => sum + (order.totalAmount || 0), 0);
  const totalPayments = Object.values(paymentBreakdown).reduce((sum, p) => sum + p.amount, 0);

  return {
    closing,
    orders: orders.map((o) => ({
      _id: o._id,
      orderNumber: o.orderNumber,
      client: o.client,
      totalAmount: o.totalAmount,
      paymentStatus: o.paymentStatus,
      createdAt: o.createdAt,
    })),
    paymentBreakdown,
    hourlyBreakdown,
    summary: {
      totalOrders: orders.length,
      totalSales,
      netSales: totalPayments,
      expectedTotal: totalPayments,
      actualTotal: null, // Not closed yet
      discrepancy: null, // Not closed yet
    },
  };
};

module.exports = {
  createClosing,
  getOpenClosing,
  closeClosing,
  reopenClosing,
  getClosingById,
  listClosings,
  getZReport,
  getOpenClosingPreview,
  generateClosingNumber,
};
