const SupplierAccountEntry = require("../models/supplierAccountEntry.model");
const Purchase = require("../models/purchase.model");
const { sendError, handleServerError } = require("../utils/http");

const signByType = (type) => {
  if (type === "CHARGE" || type === "DEBIT_NOTE") return 1;

  return -1;
};

const buildAccountFilter = (tenantId, supplierId) => ({
  tenant: tenantId,
  supplier: supplierId,
});

const computeAging = (entries) => {
  const now = new Date();
  const aging = { current: 0, days30: 0, days60: 0, days90plus: 0 };

  entries
    .filter((e) => e.type === "CHARGE" && e.sign > 0)
    .forEach((entry) => {
      const entryDate = new Date(entry.date);
      const diffDays = Math.floor((now - entryDate) / (1000 * 60 * 60 * 24));

      if (diffDays >= 90) aging.days90plus += entry.amount;
      else if (diffDays >= 60) aging.days60 += entry.amount;
      else if (diffDays >= 30) aging.days30 += entry.amount;
      else aging.current += entry.amount;
    });

  return aging;
};

exports.getSupplierAccount = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;
    const supplierId = req.params.id;
    const filter = buildAccountFilter(tenantId, supplierId);

    const entries = await SupplierAccountEntry.find(filter)
      .populate("purchase", "status total date")
      .sort({ date: 1, createdAt: 1 });

    const balance = entries.reduce((acc, entry) => acc + entry.amount * entry.sign, 0);
    const totalDebt = entries
      .filter((e) => e.sign > 0)
      .reduce((acc, e) => acc + e.amount, 0);
    const totalPaid = entries
      .filter((e) => e.sign < 0)
      .reduce((acc, e) => acc + e.amount, 0);
    const aging = computeAging(entries);

    // Get pending purchases (not fully paid)
    const pendingPurchases = await Purchase.find({
      tenant: tenantId,
      supplier: supplierId,
      paymentStatus: { $ne: "PAID" },
      status: { $in: ["CONFIRMED", "RECEIVED"] },
    })
      .select("date total paidAmount paymentStatus paymentCondition status")
      .sort({ date: -1 })
      .lean();

    return res.json({
      entries,
      balance,
      totalDebt,
      totalPaid,
      aging,
      pendingPurchases,
    });
  } catch (error) {
    return handleServerError(res, error, "Error al obtener cuenta corriente");
  }
};

exports.createPayment = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;

    const created = await SupplierAccountEntry.create({
      tenant: tenantId,
      supplier: req.params.id,
      date: req.body.date,
      type: "PAYMENT",
      amount: req.body.amount,
      sign: -1,
      paymentMethod: req.body.paymentMethod || "",
      reference: req.body.reference || "",
      notes: req.body.notes || "",
      createdBy: req.user?._id,
    });

    return res.status(201).json(created);
  } catch (error) {
    return handleServerError(res, error, "Error al registrar pago");
  }
};

exports.createEntry = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;
    const type = req.body.type;

    if (type === "PAYMENT") {
      return sendError(res, {
        status: 400,
        code: "INVALID_ENTRY_TYPE",
        message: "Para pagos usa el endpoint /payment.",
      });
    }

    const created = await SupplierAccountEntry.create({
      tenant: tenantId,
      supplier: req.params.id,
      date: req.body.date,
      type,
      amount: req.body.amount,
      sign: signByType(type),
      purchase: req.body.purchaseId || null,
      paymentMethod: req.body.paymentMethod || "",
      reference: req.body.reference || "",
      notes: req.body.notes || "",
      createdBy: req.user?._id,
    });

    return res.status(201).json(created);
  } catch (error) {
    return handleServerError(res, error, "Error al registrar asiento");
  }
};

exports.getSupplierStatement = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;
    const from = req.query.from;
    const to = req.query.to;

    const filter = buildAccountFilter(tenantId, req.params.id);

    if (from || to) {
      filter.date = {};
      if (from) filter.date.$gte = from;
      if (to) filter.date.$lte = to;
    }

    const entries = await SupplierAccountEntry.find(filter)
      .populate("purchase", "status total date")
      .sort({ date: 1, createdAt: 1 });

    const balance = entries.reduce((acc, entry) => acc + entry.amount * entry.sign, 0);

    return res.json({ entries, balance });
  } catch (error) {
    return handleServerError(res, error, "Error al obtener estado de cuenta");
  }
};
