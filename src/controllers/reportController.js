const Purchase = require("../models/purchase.model");
const Order = require("../models/order.model");
const Setting = require("../models/setting.model");
const { handleServerError, HttpError } = require("../utils/http");

/**
 * Parse a YYYY-MM-DD string into a Date.
 * Throws HttpError if invalid.
 */
function parseDateInput(value, mode = "start") {
  if (!value) return null;

  const normalized = String(value).trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new HttpError(
      400,
      "INVALID_DATE",
      "Fecha invalida. Usa el formato YYYY-MM-DD.",
    );
  }

  const date = new Date(`${normalized}T00:00:00.000Z`);

  if (Number.isNaN(date.getTime())) {
    throw new HttpError(
      400,
      "INVALID_DATE",
      "Fecha invalida. Usa el formato YYYY-MM-DD.",
    );
  }

  if (mode === "end") {
    date.setUTCHours(23, 59, 59, 999);
  }

  return date;
}

/**
 * Build start/end dates from query, defaulting to current month.
 */
function resolveDateRange(query) {
  const now = new Date();
  const defaultFrom = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const defaultTo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999));

  const from = parseDateInput(query?.from, "start") || defaultFrom;
  const to = parseDateInput(query?.to, "end") || defaultTo;

  if (from > to) {
    throw new HttpError(
      400,
      "INVALID_DATE_RANGE",
      "from no puede ser mayor a to.",
    );
  }

  return { from, to };
}

/**
 * Build a YYYY-MM period key from a Date.
 */
function periodKey(date) {
  const d = new Date(date);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * GET /api/reports/iva-purchases
 *
 * Returns IVA purchase data grouped by month.
 * Purchase.tax is the IVA amount, so net = total - tax.
 */
exports.getIvaPurchases = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;
    const { from, to } = resolveDateRange(req.query);

    const purchases = await Purchase.find({
      tenant: tenantId,
      status: { $in: ["CONFIRMED", "RECEIVED"] },
      createdAt: { $gte: from, $lte: to },
    })
      .populate("supplier", "name taxId")
      .sort({ createdAt: 1 })
      .lean();

    const periodMap = new Map();
    const details = [];

    for (const purchase of purchases) {
      const netAmount = (purchase.total || 0) - (purchase.tax || 0);
      const tax = purchase.tax || 0;
      const total = purchase.total || 0;
      const key = periodKey(purchase.createdAt);

      if (!periodMap.has(key)) {
        periodMap.set(key, { netAmount: 0, tax: 0, total: 0, count: 0 });
      }

      const period = periodMap.get(key);
      period.netAmount += netAmount;
      period.tax += tax;
      period.total += total;
      period.count += 1;

      const supplier = purchase.supplier || {};

      details.push({
        date: purchase.date || purchase.createdAt.toISOString().slice(0, 10),
        supplier: { name: supplier.name || "" },
        cuit: supplier.taxId || "",
        netAmount: Math.round(netAmount * 100) / 100,
        tax: Math.round(tax * 100) / 100,
        total: Math.round(total * 100) / 100,
        purchaseId: purchase._id,
      });
    }

    const periods = Array.from(periodMap.entries())
      .map(([period, data]) => ({
        period,
        netAmount: Math.round(data.netAmount * 100) / 100,
        tax: Math.round(data.tax * 100) / 100,
        total: Math.round(data.total * 100) / 100,
        count: data.count,
      }))
      .sort((a, b) => a.period.localeCompare(b.period));

    const totals = periods.reduce(
      (acc, p) => ({
        netAmount: acc.netAmount + p.netAmount,
        tax: acc.tax + p.tax,
        total: acc.total + p.total,
      }),
      { netAmount: 0, tax: 0, total: 0 },
    );

    totals.netAmount = Math.round(totals.netAmount * 100) / 100;
    totals.tax = Math.round(totals.tax * 100) / 100;
    totals.total = Math.round(totals.total * 100) / 100;

    return res.json({
      periods,
      totals,
      details,
      dateRange: {
        from: from.toISOString().slice(0, 10),
        to: to.toISOString().slice(0, 10),
      },
    });
  } catch (error) {
    return handleServerError(res, error, "Error al obtener reporte de IVA compras");
  }
};

/**
 * GET /api/reports/iva-sales
 *
 * Returns IVA sales data grouped by month.
 * Orders don't have a tax field, so IVA is computed from the configured taxRate.
 */
exports.getIvaSales = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;
    const { from, to } = resolveDateRange(req.query);

    // Fetch the tax rate from settings (default 21% for Argentina)
    const setting = await Setting.findOne({ tenant: tenantId }).lean();
    const taxRate = (setting && setting.taxRate > 0 ? setting.taxRate : 21) / 100;

    const orders = await Order.find({
      tenant: tenantId,
      paymentStatus: { $in: ["Pagado", "Parcial"] },
      salesStatus: { $ne: "Cancelada" },
      createdAt: { $gte: from, $lte: to },
    })
      .populate("client", "name taxId")
      .sort({ createdAt: 1 })
      .lean();

    const periodMap = new Map();
    const details = [];

    for (const order of orders) {
      const total = order.totalAmount || 0;
      // net = total / (1 + taxRate), tax = total - net
      const netAmount = taxRate > 0 ? Math.round((total / (1 + taxRate)) * 100) / 100 : total;
      const tax = Math.round((total - netAmount) * 100) / 100;
      const key = periodKey(order.createdAt);

      if (!periodMap.has(key)) {
        periodMap.set(key, { netAmount: 0, tax: 0, total: 0, count: 0 });
      }

      const period = periodMap.get(key);
      period.netAmount += netAmount;
      period.tax += tax;
      period.total += total;
      period.count += 1;

      const client = order.client || {};

      details.push({
        date: order.createdAt.toISOString().slice(0, 10),
        client: { name: client.name || "" },
        cuit: client.taxId || "",
        netAmount: Math.round(netAmount * 100) / 100,
        tax: Math.round(tax * 100) / 100,
        total: Math.round(total * 100) / 100,
        orderId: order._id,
      });
    }

    const periods = Array.from(periodMap.entries())
      .map(([period, data]) => ({
        period,
        netAmount: Math.round(data.netAmount * 100) / 100,
        tax: Math.round(data.tax * 100) / 100,
        total: Math.round(data.total * 100) / 100,
        count: data.count,
      }))
      .sort((a, b) => a.period.localeCompare(b.period));

    const totals = periods.reduce(
      (acc, p) => ({
        netAmount: acc.netAmount + p.netAmount,
        tax: acc.tax + p.tax,
        total: acc.total + p.total,
      }),
      { netAmount: 0, tax: 0, total: 0 },
    );

    totals.netAmount = Math.round(totals.netAmount * 100) / 100;
    totals.tax = Math.round(totals.tax * 100) / 100;
    totals.total = Math.round(totals.total * 100) / 100;

    return res.json({
      periods,
      totals,
      details,
      dateRange: {
        from: from.toISOString().slice(0, 10),
        to: to.toISOString().slice(0, 10),
      },
    });
  } catch (error) {
    return handleServerError(res, error, "Error al obtener reporte de IVA ventas");
  }
};
