const ClientAccountEntry = require("../models/clientAccountEntry.model");
const { sendError, handleServerError } = require("../utils/http");

const signByType = (type) => {
  if (type === "CHARGE" || type === "DEBIT_NOTE") return 1;
  return -1;
};

const buildFilter = (tenantId, clientId) => ({ tenant: tenantId, client: clientId });

exports.getClientAccount = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;
    const entries = await ClientAccountEntry.find(buildFilter(tenantId, req.params.id))
      .populate("order", "status total date")
      .sort({ date: 1, createdAt: 1 });

    const balance = entries.reduce((acc, e) => acc + e.amount * e.sign, 0);
    return res.json({ entries, balance });
  } catch (error) {
    return handleServerError(res, error, "Error al obtener cuenta corriente del cliente");
  }
};

exports.createPayment = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;
    const created = await ClientAccountEntry.create({
      tenant: tenantId,
      client: req.params.id,
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
        message: "Para pagos usá el endpoint /payment.",
      });
    }

    const created = await ClientAccountEntry.create({
      tenant: tenantId,
      client: req.params.id,
      date: req.body.date,
      type,
      amount: req.body.amount,
      sign: signByType(type),
      order: req.body.orderId || null,
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

exports.getClientStatement = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;
    const { from, to } = req.query;
    const filter = buildFilter(tenantId, req.params.id);

    if (from || to) {
      filter.date = {};
      if (from) filter.date.$gte = from;
      if (to) filter.date.$lte = to;
    }

    const entries = await ClientAccountEntry.find(filter)
      .populate("order", "status total date")
      .sort({ date: 1, createdAt: 1 });

    const balance = entries.reduce((acc, e) => acc + e.amount * e.sign, 0);
    return res.json({ entries, balance });
  } catch (error) {
    return handleServerError(res, error, "Error al obtener estado de cuenta del cliente");
  }
};
