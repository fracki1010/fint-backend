const mongoose = require("mongoose");
const ClientAccountEntry = require("../models/clientAccountEntry.model");
const SupplierAccountEntry = require("../models/supplierAccountEntry.model");
const Order = require("../models/order.model");
const Purchase = require("../models/purchase.model");
const BankAccount = require("../models/bankAccount.model");
const CashClosing = require("../models/cashClosing.model");
const { HttpError } = require("../utils/http");

const KNOWN_METHODS = Object.freeze([
  "cash",
  "card",
  "transfer",
  "mercadopago",
  "check",
  "other",
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Normalizes a payment method string.
 * Empty strings and unknown methods map to "other".
 * @param {string} method
 * @returns {string}
 */
function normalizePaymentMethod(method) {
  const m = (method || "").trim().toLowerCase();
  if (!m || !KNOWN_METHODS.includes(m)) return "other";
  return m;
}

/**
 * Returns a fresh byMethod accumulator with all known methods at zero.
 * @returns {Object}
 */
function buildEmptyByMethod() {
  return { cash: 0, card: 0, transfer: 0, mercadopago: 0, check: 0, other: 0 };
}

/**
 * Normalizes date range inputs into ISO date strings (YYYY-MM-DD).
 * If dateFrom is not provided, defaults to the first day of the current month.
 * If dateTo is not provided, defaults to today.
 * @param {string|Date} dateFrom
 * @param {string|Date} dateTo
 * @returns {[string, string]} [fromStr, toStr]
 */
function normalizeDateRange(dateFrom, dateTo) {
  const now = new Date();

  let fromStr;
  if (dateFrom) {
    const d = new Date(dateFrom);
    if (Number.isNaN(d.getTime())) {
      throw new HttpError(400, "INVALID_DATE", "Fecha de inicio inválida.");
    }
    fromStr = d.toISOString().substring(0, 10);
  } else {
    const y = now.getUTCFullYear();
    const m = String(now.getUTCMonth() + 1).padStart(2, "0");
    fromStr = `${y}-${m}-01`;
  }

  let toStr;
  if (dateTo) {
    const d = new Date(dateTo);
    if (Number.isNaN(d.getTime())) {
      throw new HttpError(400, "INVALID_DATE", "Fecha de fin inválida.");
    }
    toStr = d.toISOString().substring(0, 10);
  } else {
    toStr = now.toISOString().substring(0, 10);
  }

  return [fromStr, toStr];
}

/**
 * Converts a Date to an ISO week key (e.g. "2026-W19").
 * Handles year boundaries correctly (Dec→Jan week 1, Jan→prev year week 53).
 * @param {Date} d - UTC date
 * @returns {string}
 */
function getISOWeekKey(d) {
  const temp = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
  const dayNum = (temp.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
  temp.setUTCDate(temp.getUTCDate() - dayNum + 3); // Thursday of same ISO week
  const firstThursday = temp.valueOf();
  temp.setUTCMonth(0, 1);
  if (temp.getUTCDay() !== 4) {
    temp.setUTCMonth(0, 1 + ((4 - temp.getUTCDay()) + 7) % 7);
  }
  const weekNum =
    1 + Math.ceil((firstThursday - temp) / 604800000);
  const year = new Date(firstThursday).getUTCFullYear();
  return `${year}-W${String(weekNum).padStart(2, "0")}`;
}

/**
 * Returns the period key for a date string according to the grouping.
 * @param {string} dateStr - "YYYY-MM-DD"
 * @param {string} groupBy - "day" | "week" | "month"
 * @returns {string}
 */
function getPeriodKey(dateStr, groupBy) {
  if (groupBy === "day") return dateStr;
  if (groupBy === "month") return dateStr.substring(0, 7);
  if (groupBy === "week")
    return getISOWeekKey(new Date(`${dateStr}T00:00:00.000Z`));

  throw new HttpError(
    400,
    "INVALID_GROUP_BY",
    "groupBy debe ser day, week o month",
  );
}

/**
 * Generates all period keys between two ISO date strings (inclusive).
 * @param {string} fromStr - "YYYY-MM-DD"
 * @param {string} toStr - "YYYY-MM-DD"
 * @param {string} groupBy
 * @returns {string[]}
 */
function generatePeriodKeys(fromStr, toStr, groupBy) {
  const from = new Date(`${fromStr}T00:00:00.000Z`);
  const to = new Date(`${toStr}T23:59:59.999Z`);
  const keys = [];

  if (groupBy === "day") {
    const cursor = new Date(from);
    cursor.setUTCHours(0, 0, 0, 0);
    while (cursor <= to) {
      keys.push(cursor.toISOString().substring(0, 10));
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  } else if (groupBy === "month") {
    const cursor = new Date(
      Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1),
    );
    const endVal = new Date(
      Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 1),
    );
    while (cursor <= endVal) {
      keys.push(
        `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, "0")}`,
      );
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
  } else if (groupBy === "week") {
    const cursor = new Date(from);
    cursor.setUTCHours(0, 0, 0, 0);
    const day = cursor.getUTCDay();
    cursor.setUTCDate(cursor.getUTCDate() - (day === 0 ? 6 : day - 1));
    while (cursor <= to) {
      keys.push(getISOWeekKey(cursor));
      cursor.setUTCDate(cursor.getUTCDate() + 7);
    }
  }

  return keys;
}

// ---------------------------------------------------------------------------
// Main service functions
// ---------------------------------------------------------------------------

/**
 * Returns a unified treasury overview for a date range.
 *
 * Money-in is aggregated from:
 *   1) ClientAccountEntry PAYMENTs (sign=-1) grouped by payment method
 *   2) Orders with paymentStatus="Pagado" that do NOT have a matching
 *      ClientAccountEntry (LEFT JOIN dedup)
 *
 * Money-out follows the same pattern with SupplierAccountEntry and Purchase.
 *
 * @param {string} tenantId
 * @param {string|Date} dateFrom
 * @param {string|Date} dateTo
 * @returns {Promise<Object>} TreasuryOverview
 */
async function getOverview(tenantId, dateFrom, dateTo) {
  const [fromStr, toStr] = normalizeDateRange(dateFrom, dateTo);
  const tenantObjId = new mongoose.Types.ObjectId(tenantId);

  const paidAtStart = new Date(`${fromStr}T00:00:00.000Z`);
  const paidAtEnd = new Date(`${toStr}T23:59:59.999Z`);

  // -----------------------------------------------------------------------
  // MONEY IN
  // -----------------------------------------------------------------------
  const caeMatch = {
    tenant: tenantObjId,
    type: "PAYMENT",
    sign: -1,
    date: { $gte: fromStr, $lte: toStr },
  };

  const [caePayments, excludedOrderIdsRaw] = await Promise.all([
    ClientAccountEntry.aggregate([
      { $match: caeMatch },
      {
        $group: {
          _id: "$paymentMethod",
          total: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
    ]),
    ClientAccountEntry.distinct("order", caeMatch),
  ]);

  const excludedOrderIds = excludedOrderIdsRaw.filter(Boolean);

  const orderQuery = {
    tenant: tenantObjId,
    paymentStatus: "Pagado",
    paidAt: { $gte: paidAtStart, $lte: paidAtEnd },
  };
  if (excludedOrderIds.length > 0) {
    orderQuery._id = { $nin: excludedOrderIds };
  }

  const extraOrders = await Order.find(orderQuery)
    .select("totalAmount")
    .lean();

  // Build moneyIn accumulators
  const moneyInByMethod = buildEmptyByMethod();
  let moneyInTotal = 0;
  let moneyInCount = 0;

  caePayments.forEach((entry) => {
    const method = normalizePaymentMethod(entry._id);
    moneyInByMethod[method] += entry.total;
    moneyInTotal += entry.total;
    moneyInCount += entry.count;
  });

  const extraOrderTotal = extraOrders.reduce(
    (sum, o) => sum + (o.totalAmount || 0),
    0,
  );
  if (extraOrderTotal > 0) {
    moneyInByMethod.other += extraOrderTotal;
    moneyInTotal += extraOrderTotal;
    moneyInCount += extraOrders.length;
  }

  // -----------------------------------------------------------------------
  // MONEY OUT
  // -----------------------------------------------------------------------
  const saeMatch = {
    tenant: tenantObjId,
    type: "PAYMENT",
    sign: -1,
    date: { $gte: fromStr, $lte: toStr },
  };

  const [saePayments, excludedPurchaseIdsRaw] = await Promise.all([
    SupplierAccountEntry.aggregate([
      { $match: saeMatch },
      {
        $group: {
          _id: "$paymentMethod",
          total: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
    ]),
    SupplierAccountEntry.distinct("purchase", saeMatch),
  ]);

  const excludedPurchaseIds = excludedPurchaseIdsRaw.filter(Boolean);

  const purchaseQuery = {
    tenant: tenantObjId,
    paymentStatus: "PAID",
    paidAt: { $gte: paidAtStart, $lte: paidAtEnd },
  };
  if (excludedPurchaseIds.length > 0) {
    purchaseQuery._id = { $nin: excludedPurchaseIds };
  }

  const extraPurchases = await Purchase.find(purchaseQuery)
    .select("total")
    .lean();

  // Build moneyOut accumulators
  const moneyOutByMethod = buildEmptyByMethod();
  let moneyOutTotal = 0;
  let moneyOutCount = 0;

  saePayments.forEach((entry) => {
    const method = normalizePaymentMethod(entry._id);
    moneyOutByMethod[method] += entry.total;
    moneyOutTotal += entry.total;
    moneyOutCount += entry.count;
  });

  const extraPurchaseTotal = extraPurchases.reduce(
    (sum, p) => sum + (p.total || 0),
    0,
  );
  if (extraPurchaseTotal > 0) {
    moneyOutByMethod.other += extraPurchaseTotal;
    moneyOutTotal += extraPurchaseTotal;
    moneyOutCount += extraPurchases.length;
  }

  // -----------------------------------------------------------------------
  // BALANCES
  // -----------------------------------------------------------------------
  const [bankAccounts, openClosing] = await Promise.all([
    BankAccount.find({ tenant: tenantObjId, isActive: true })
      .select("name bank currentBalance")
      .lean(),
    CashClosing.findOne({ tenant: tenantObjId, status: "open" })
      .select("expectedTotal")
      .lean(),
  ]);

  const cashInRegister = openClosing ? openClosing.expectedTotal : null;
  const totalBankBalance = bankAccounts.reduce(
    (sum, a) => sum + (a.currentBalance || 0),
    0,
  );
  const totalBalance = totalBankBalance + (cashInRegister || 0);

  return {
    moneyIn: {
      total: moneyInTotal,
      byMethod: moneyInByMethod,
      transactionCount: moneyInCount,
    },
    moneyOut: {
      total: moneyOutTotal,
      byMethod: moneyOutByMethod,
      transactionCount: moneyOutCount,
    },
    netCashFlow: moneyInTotal - moneyOutTotal,
    balances: {
      bankAccounts: bankAccounts.map((a) => ({
        _id: a._id,
        name: a.name,
        bank: a.bank,
        currentBalance: a.currentBalance,
      })),
      cashInRegister,
      totalBalance,
    },
  };
}

/**
 * Returns a cash-flow time-series grouped by period.
 *
 * Money-in comes from ClientAccountEntry PAYMENTs;
 * money-out comes from SupplierAccountEntry PAYMENTs.
 *
 * Max 36 periods — throws 400 if exceeded.
 *
 * @param {string} tenantId
 * @param {string|Date} dateFrom
 * @param {string|Date} dateTo
 * @param {"day"|"week"|"month"} [groupBy="month"]
 * @returns {Promise<Object>} { series, totals }
 */
async function getCashFlow(tenantId, dateFrom, dateTo, groupBy = "month") {
  const validGroupBy = ["day", "week", "month"];
  if (!validGroupBy.includes(groupBy)) {
    throw new HttpError(
      400,
      "INVALID_GROUP_BY",
      'groupBy debe ser day, week o month',
    );
  }

  const [fromStr, toStr] = normalizeDateRange(dateFrom, dateTo);
  const tenantObjId = new mongoose.Types.ObjectId(tenantId);

  const [caeEntries, saeEntries] = await Promise.all([
    ClientAccountEntry.find({
      tenant: tenantObjId,
      type: "PAYMENT",
      sign: -1,
      date: { $gte: fromStr, $lte: toStr },
    })
      .select("amount date")
      .lean(),
    SupplierAccountEntry.find({
      tenant: tenantObjId,
      type: "PAYMENT",
      sign: -1,
      date: { $gte: fromStr, $lte: toStr },
    })
      .select("amount date")
      .lean(),
  ]);

  // Group entries by period in JS
  /** @type {Object<string, {period: string, moneyIn: number, moneyOut: number, net: number}>} */
  const seriesMap = {};

  caeEntries.forEach((entry) => {
    const period = getPeriodKey(entry.date, groupBy);
    if (!seriesMap[period])
      seriesMap[period] = { period, moneyIn: 0, moneyOut: 0, net: 0 };
    seriesMap[period].moneyIn += entry.amount || 0;
  });

  saeEntries.forEach((entry) => {
    const period = getPeriodKey(entry.date, groupBy);
    if (!seriesMap[period])
      seriesMap[period] = { period, moneyIn: 0, moneyOut: 0, net: 0 };
    seriesMap[period].moneyOut += entry.amount || 0;
  });

  // Compute net for periods that have data
  Object.values(seriesMap).forEach((s) => {
    s.net = s.moneyIn - s.moneyOut;
  });

  // Build the full list of periods in range and fill gaps
  const allPeriods = generatePeriodKeys(fromStr, toStr, groupBy);

  if (allPeriods.length > 36) {
    throw new HttpError(
      400,
      "TOO_MANY_PERIODS",
      `El rango seleccionado genera ${allPeriods.length} períodos. ` +
        "El máximo permitido es 36. Reducí el rango de fechas o usá un agrupamiento mayor.",
    );
  }

  const series = allPeriods.map((period) => {
    const existing = seriesMap[period];
    return existing || { period, moneyIn: 0, moneyOut: 0, net: 0 };
  });

  const totals = {
    moneyIn: series.reduce((sum, s) => sum + s.moneyIn, 0),
    moneyOut: series.reduce((sum, s) => sum + s.moneyOut, 0),
    net: series.reduce((sum, s) => sum + s.net, 0),
  };

  return { series, totals };
}

module.exports = {
  getOverview,
  getCashFlow,
  normalizePaymentMethod,
  normalizeDateRange,
};
