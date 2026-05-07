const ClientAccountEntry = require("../models/clientAccountEntry.model");
const {
  allocatePayment,
  getClientBalance,
  getPendingCharges,
  getAgingReport,
  getCreditStatus,
} = require("../services/accountService");
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

// ── Payment Allocation (PR 1: Core Reconciliation) ────────────────────────

exports.allocatePayment = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;
    const clientId = req.params.id;
    const { amount, paymentMethod, reference, notes, allocations } = req.body;
    const createdBy = req.user?._id;

    // Validate input
    if (!amount || amount <= 0) {
      return sendError(res, {
        status: 400,
        code: "INVALID_AMOUNT",
        message: "El monto del pago debe ser mayor a cero",
      });
    }

    const result = await allocatePayment(tenantId, clientId, amount, {
      paymentMethod: paymentMethod || "",
      reference: reference || "",
      notes: notes || "",
      createdBy,
      manualAllocations: allocations || null,
    });

    return res.status(201).json({
      success: true,
      paymentEntry: result.paymentEntry,
      allocations: result.allocations,
      affectedCharges: result.affectedCharges,
      unallocatedAmount: result.unallocatedAmount,
    });
  } catch (error) {
    if (error.message?.includes("exceeds remaining")) {
      return sendError(res, {
        status: 400,
        code: "ALLOCATION_EXCEEDS_REMAINING",
        message: error.message,
      });
    }
    if (error.message?.includes("not found")) {
      return sendError(res, {
        status: 404,
        code: "CHARGE_NOT_FOUND",
        message: error.message,
      });
    }
    return handleServerError(res, error, "Error al asignar el pago");
  }
};

exports.getClientBalance = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;
    const clientId = req.params.id;

    const balance = await getClientBalance(tenantId, clientId);

    return res.json({
      clientId,
      balance,
      formattedBalance: balance.toLocaleString("es-AR", {
        style: "currency",
        currency: "ARS",
      }),
    });
  } catch (error) {
    return handleServerError(res, error, "Error al calcular el saldo del cliente");
  }
};

exports.getPendingCharges = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;
    const clientId = req.params.id;

    const charges = await getPendingCharges(tenantId, clientId);

    return res.json({
      clientId,
      charges,
      totalPending: charges.reduce((sum, c) => sum + c.remainingAmount, 0),
    });
  } catch (error) {
    return handleServerError(res, error, "Error al obtener cargos pendientes");
  }
};

// ── Aging & Credit (PR 2: Aging & Reporting) ─────────────────────────────

exports.getClientAging = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;
    const clientId = req.params.id;

    const agingReport = await getAgingReport(tenantId, clientId);

    if (agingReport.clients.length === 0) {
      return res.json({
        clientId,
        clientName: null,
        totalOutstanding: 0,
        buckets: {
          current: 0,
          "1-30": 0,
          "31-60": 0,
          "61-90": 0,
          "90+": 0,
        },
        entries: [],
        generatedAt: agingReport.generatedAt,
      });
    }

    const clientAging = agingReport.clients[0];

    return res.json({
      clientId,
      clientName: clientAging.clientName,
      totalOutstanding: clientAging.totalOutstanding,
      buckets: {
        current: clientAging.current || 0,
        "1-30": clientAging.overdue1to30 || 0,
        "31-60": clientAging.overdue31to60 || 0,
        "61-90": clientAging.overdue61to90 || 0,
        "90+": clientAging.overdue90plus || 0,
      },
      entries: clientAging.buckets,
      generatedAt: agingReport.generatedAt,
    });
  } catch (error) {
    return handleServerError(res, error, "Error al obtener reporte de antigüedad");
  }
};

exports.getAllClientsAging = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;

    const agingReport = await getAgingReport(tenantId);

    return res.json({
      clients: agingReport.clients.map((client) => ({
        clientId: client.clientId,
        clientName: client.clientName,
        clientPhone: client.clientPhone,
        creditLimit: client.creditLimit,
        totalOutstanding: client.totalOutstanding,
        buckets: {
          current: client.current || 0,
          "1-30": client.overdue1to30 || 0,
          "31-60": client.overdue31to60 || 0,
          "61-90": client.overdue61to90 || 0,
          "90+": client.overdue90plus || 0,
        },
      })),
      totals: agingReport.totals,
      generatedAt: agingReport.generatedAt,
    });
  } catch (error) {
    return handleServerError(res, error, "Error al obtener reporte de antigüedad general");
  }
};

exports.getClientCreditStatus = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;
    const clientId = req.params.id;

    const creditStatus = await getCreditStatus(tenantId, clientId);

    return res.json(creditStatus);
  } catch (error) {
    if (error.message?.includes("not found")) {
      return sendError(res, {
        status: 404,
        code: "CLIENT_NOT_FOUND",
        message: "Cliente no encontrado",
      });
    }
    return handleServerError(res, error, "Error al obtener estado de crédito");
  }
};
