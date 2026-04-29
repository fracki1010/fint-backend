const SupplierAccountEntry = require("../models/supplierAccountEntry.model");
const { sendError, handleServerError } = require("../utils/http");

const signByType = (type) => {
  if (type === "CHARGE" || type === "DEBIT_NOTE") return 1;

  return -1;
};

const buildAccountFilter = (tenantId, supplierId) => ({
  tenant: tenantId,
  supplier: supplierId,
});

exports.getSupplierAccount = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;
    const filter = buildAccountFilter(tenantId, req.params.id);

    const entries = await SupplierAccountEntry.find(filter)
      .populate("purchase", "status total date")
      .sort({ date: 1, createdAt: 1 });

    const balance = entries.reduce((acc, entry) => acc + entry.amount * entry.sign, 0);

    return res.json({ entries, balance });
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
