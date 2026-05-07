const mongoose = require("mongoose");
const BankTransaction = require("../models/bankTransaction.model");
const BankAccount = require("../models/bankAccount.model");
const ClientAccountEntry = require("../models/clientAccountEntry.model");
const SupplierAccountEntry = require("../models/supplierAccountEntry.model");
const Order = require("../models/order.model");

/**
 * Normalize a record to the unified MatchCandidate shape.
 * @param {Object} record - Raw document from any source collection
 * @param {'ClientAccountEntry'|'SupplierAccountEntry'|'Order'} type
 * @returns {Object} Unified candidate object
 */
function normalizeCandidate(record, type) {
  if (type === "ClientAccountEntry") {
    return {
      id: record._id,
      type: "ClientAccountEntry",
      date: record.date,
      description: record.reference
        ? `Pago de cliente - ${record.reference}`
        : "Pago de cliente",
      amount: Math.abs(record.amount),
      paymentMethod: record.paymentMethod || "",
      source: record.client?.name || "",
    };
  }

  if (type === "SupplierAccountEntry") {
    return {
      id: record._id,
      type: "SupplierAccountEntry",
      date: record.date,
      description: record.reference
        ? `Pago a proveedor - ${record.reference}`
        : "Pago a proveedor",
      amount: Math.abs(record.amount),
      paymentMethod: record.paymentMethod || "",
      source: record.supplier?.name || "",
    };
  }

  // Order
  return {
    id: record._id,
    type: "Order",
    date: record.paidAt ? record.paidAt.toISOString().split("T")[0] : "",
    description: `Orden ${record.orderNumber || ""} - ${record.client?.name || ""}`,
    amount: record.totalAmount,
    paymentMethod: record.paymentMethod || "",
    source: record.orderNumber || "",
  };
}

/**
 * Get reconciliation data: bank transactions + candidate records for a date range.
 * @param {string} tenantId
 * @param {string} bankAccountId
 * @param {Date} dateFrom
 * @param {Date} dateTo
 * @returns {Promise<Object>} { bankTransactions, candidates, unmatchedTransactions, unmatchedCandidates, balance }
 */
exports.getReconciliationData = async (tenantId, bankAccountId, dateFrom, dateTo) => {
  // 1. Query bank transactions for the account within date range
  const bankTransactions = await BankTransaction.find({
    tenant: tenantId,
    bankAccount: bankAccountId,
    date: { $gte: dateFrom, $lte: dateTo },
  })
    .sort({ date: -1 })
    .lean();

  // 2. Query candidate internal records
  const [clientPayments, supplierPayments, paidOrders] = await Promise.all([
    ClientAccountEntry.find({
      tenant: tenantId,
      type: "PAYMENT",
      date: { $gte: dateFromStr(dateFrom), $lte: dateToStr(dateTo) },
    })
      .populate("client", "name")
      .sort({ date: -1 })
      .lean(),

    SupplierAccountEntry.find({
      tenant: tenantId,
      type: "PAYMENT",
      date: { $gte: dateFromStr(dateFrom), $lte: dateToStr(dateTo) },
    })
      .populate("supplier", "name")
      .sort({ date: -1 })
      .lean(),

    Order.find({
      tenant: tenantId,
      paymentStatus: "Pagado",
      paidAt: { $gte: dateFrom, $lte: dateTo },
    })
      .populate("client", "name")
      .sort({ paidAt: -1 })
      .lean(),
  ]);

  // 3. Normalize all candidates
  const clientCandidates = clientPayments.map((r) => normalizeCandidate(r, "ClientAccountEntry"));
  const supplierCandidates = supplierPayments.map((r) => normalizeCandidate(r, "SupplierAccountEntry"));
  const orderCandidates = paidOrders.map((r) => normalizeCandidate(r, "Order"));

  const allCandidates = [...clientCandidates, ...supplierCandidates, ...orderCandidates].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
  );

  // 4. Separate matched from unmatched
  const matchedTransactionIds = new Set(
    bankTransactions.filter((tx) => tx.status === "reconciled").map((tx) => tx._id.toString()),
  );

  const unmatchedTransactions = bankTransactions.filter(
    (tx) => !matchedTransactionIds.has(tx._id.toString()),
  );

  const matchedCandidateIds = new Set(
    bankTransactions
      .filter((tx) => tx.status === "reconciled" && tx.matchedEntryId)
      .map((tx) => tx.matchedEntryId.toString()),
  );

  const unmatchedCandidates = allCandidates.filter(
    (c) => !matchedCandidateIds.has(c.id),
  );

  // 5. Compute balance info
  const bankAccount = await BankAccount.findById(bankAccountId).lean();
  const currentBalance = bankAccount?.currentBalance || 0;

  const unreconciledTransactions = unmatchedTransactions;
  const unreconciledDebits = unreconciledTransactions
    .filter((tx) => tx.type === "debit")
    .reduce((sum, tx) => sum + tx.amount, 0);
  const unreconciledCredits = unreconciledTransactions
    .filter((tx) => tx.type === "credit")
    .reduce((sum, tx) => sum + tx.amount, 0);

  return {
    bankTransactions,
    candidates: allCandidates,
    unmatchedTransactions,
    unmatchedCandidates,
    balance: {
      current: currentBalance,
      unreconciledDebits,
      unreconciledCredits,
    },
  };
};

/**
 * Match a bank transaction to an internal record.
 * @param {string} tenantId
 * @param {string} transactionId
 * @param {'ClientAccountEntry'|'SupplierAccountEntry'|'Order'} matchedEntryType
 * @param {string} matchedEntryId
 * @returns {Promise<Object>} Updated bank transaction
 */
exports.matchTransaction = async (tenantId, transactionId, matchedEntryType, matchedEntryId) => {
  const transaction = await BankTransaction.findOne({
    _id: transactionId,
    tenant: tenantId,
  });

  if (!transaction) {
    const error = new Error("Transacción no encontrada");
    error.status = 404;
    error.code = "NOT_FOUND";
    throw error;
  }

  if (transaction.status === "reconciled") {
    const error = new Error("La transacción ya está reconciliada");
    error.status = 409;
    error.code = "ALREADY_RECONCILED";
    throw error;
  }

  transaction.status = "reconciled";
  transaction.matchedEntryType = matchedEntryType;
  transaction.matchedEntryId = matchedEntryId;
  transaction.reconciliationDate = new Date();

  await transaction.save();
  return transaction;
};

/**
 * Unmatch a reconciled transaction.
 * @param {string} tenantId
 * @param {string} transactionId
 * @returns {Promise<Object>} Updated bank transaction
 */
exports.unmatchTransaction = async (tenantId, transactionId) => {
  const transaction = await BankTransaction.findOne({
    _id: transactionId,
    tenant: tenantId,
  });

  if (!transaction) {
    const error = new Error("Transacción no encontrada");
    error.status = 404;
    error.code = "NOT_FOUND";
    throw error;
  }

  if (transaction.status !== "reconciled") {
    const error = new Error("La transacción no está reconciliada");
    error.status = 400;
    error.code = "NOT_RECONCILED";
    throw error;
  }

  transaction.status = "cleared";
  transaction.matchedEntryType = null;
  transaction.matchedEntryId = null;
  transaction.reconciliationDate = null;

  await transaction.save();
  return transaction;
};

/**
 * Confirm reconciliation for a bank account.
 * Uses MongoDB transaction to atomically update balance and finalize period.
 * @param {string} tenantId
 * @param {string} bankAccountId
 * @param {string} endDate - ISO date string for the period end
 * @returns {Promise<Object>} { lastReconciledAt, currentBalance }
 */
exports.confirmReconciliation = async (tenantId, bankAccountId, endDate) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // 1. Find all reconciled transactions for this account
    const reconciledTransactions = await BankTransaction.find({
      tenant: tenantId,
      bankAccount: bankAccountId,
      status: "reconciled",
    }).session(session);

    // 2. Calculate net balance change
    let netChange = 0;
    for (const tx of reconciledTransactions) {
      if (tx.type === "credit") {
        netChange += tx.amount;
      } else {
        netChange -= tx.amount;
      }
    }

    // 3. Update bank account
    const bankAccount = await BankAccount.findById(bankAccountId).session(session);

    if (!bankAccount) {
      const error = new Error("Cuenta bancaria no encontrada");
      error.status = 404;
      error.code = "NOT_FOUND";
      throw error;
    }

    bankAccount.currentBalance = bankAccount.currentBalance + netChange;
    bankAccount.lastReconciledAt = new Date();
    bankAccount.lastReconciliationEndDate = new Date(endDate);

    await bankAccount.save({ session });

    await session.commitTransaction();

    return {
      lastReconciledAt: bankAccount.lastReconciledAt,
      currentBalance: bankAccount.currentBalance,
      reconciledCount: reconciledTransactions.length,
      netChange,
    };
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

// ── Helpers ──

function dateFromStr(date) {
  return date.toISOString().split("T")[0];
}

function dateToStr(date) {
  return date.toISOString().split("T")[0];
}
