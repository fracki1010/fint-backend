const mongoose = require("mongoose");

const PaymentOrder = require("../models/paymentOrder.model");
const Purchase = require("../models/purchase.model");
const SupplierAccountEntry = require("../models/supplierAccountEntry.model");
const { sendError, handleServerError } = require("../utils/http");

// ── List Payment Orders ─────────────────────────────────────────────────

/**
 * GET /api/payment-orders
 * Supports filtering by supplier, status, dateFrom, dateTo.
 */
exports.listPaymentOrders = async (req, res) => {
  try {
    const { supplier, status, dateFrom, dateTo } = req.query;
    const filter = { tenant: req.user.tenant };

    if (supplier) {
      filter.supplier = supplier;
    }

    if (status) {
      filter.status = status;
    }

    if (dateFrom || dateTo) {
      filter.date = {};
      if (dateFrom) filter.date.$gte = dateFrom;
      if (dateTo) filter.date.$lte = dateTo;
    }

    const paymentOrders = await PaymentOrder.find(filter)
      .populate("supplier", "name company")
      .populate("items.purchase", "date total paidAmount paymentStatus")
      .sort({ createdAt: -1 });

    return res.json(paymentOrders);
  } catch (error) {
    return handleServerError(res, error, "Error al obtener órdenes de pago");
  }
};

// ── Get Single Payment Order ────────────────────────────────────────────

/**
 * GET /api/payment-orders/:id
 */
exports.getPaymentOrder = async (req, res) => {
  try {
    const paymentOrder = await PaymentOrder.findOne({
      _id: req.params.id,
      tenant: req.user.tenant,
    })
      .populate("supplier", "name company phone taxId")
      .populate("items.purchase", "date total paidAmount paymentStatus paymentCondition dueDate")
      .populate("createdBy", "fullName email");

    if (!paymentOrder) {
      return sendError(res, {
        status: 404,
        code: "PAYMENT_ORDER_NOT_FOUND",
        message: "Orden de pago no encontrada",
      });
    }

    return res.json(paymentOrder);
  } catch (error) {
    return handleServerError(res, error, "Error al obtener la orden de pago");
  }
};

// ── Create Payment Order ────────────────────────────────────────────────

/**
 * POST /api/payment-orders
 * Creates a DRAFT payment order (just records what will be paid).
 */
exports.createPaymentOrder = async (req, res) => {
  try {
    const { supplierId, date, paymentMethod, reference, notes, items, total } = req.body;

    const paymentOrder = await PaymentOrder.create({
      tenant: req.user.tenant,
      supplier: supplierId,
      date,
      paymentMethod: paymentMethod || "transfer",
      reference: reference || "",
      notes: notes || "",
      status: "DRAFT",
      items: items.map((item) => ({
        purchase: item.purchaseId,
        amount: item.amount,
      })),
      total,
      createdBy: req.user._id || null,
    });

    const hydrated = await PaymentOrder.findById(paymentOrder._id)
      .populate("supplier", "name company")
      .populate("items.purchase", "date total paidAmount paymentStatus");

    return res.status(201).json(hydrated);
  } catch (error) {
    return handleServerError(res, error, "Error al crear la orden de pago");
  }
};

// ── Update Payment Order ────────────────────────────────────────────────

/**
 * PUT /api/payment-orders/:id
 * Only allowed when status is DRAFT.
 */
exports.updatePaymentOrder = async (req, res) => {
  try {
    const paymentOrder = await PaymentOrder.findOne({
      _id: req.params.id,
      tenant: req.user.tenant,
    });

    if (!paymentOrder) {
      return sendError(res, {
        status: 404,
        code: "PAYMENT_ORDER_NOT_FOUND",
        message: "Orden de pago no encontrada",
      });
    }

    if (paymentOrder.status !== "DRAFT") {
      return sendError(res, {
        status: 409,
        code: "PAYMENT_ORDER_NOT_EDITABLE",
        message: "Solo se pueden editar órdenes de pago en estado borrador",
      });
    }

    const { supplierId, date, paymentMethod, reference, notes, items, total } = req.body;

    if (supplierId !== undefined) paymentOrder.supplier = supplierId;
    if (date !== undefined) paymentOrder.date = date;
    if (paymentMethod !== undefined) paymentOrder.paymentMethod = paymentMethod;
    if (reference !== undefined) paymentOrder.reference = reference;
    if (notes !== undefined) paymentOrder.notes = notes;
    if (items !== undefined) {
      paymentOrder.items = items.map((item) => ({
        purchase: item.purchaseId,
        amount: item.amount,
      }));
    }
    if (total !== undefined) paymentOrder.total = total;

    await paymentOrder.save();

    const hydrated = await PaymentOrder.findById(paymentOrder._id)
      .populate("supplier", "name company")
      .populate("items.purchase", "date total paidAmount paymentStatus");

    return res.json(hydrated);
  } catch (error) {
    return handleServerError(res, error, "Error al actualizar la orden de pago");
  }
};

// ── Delete Payment Order ────────────────────────────────────────────────

/**
 * DELETE /api/payment-orders/:id
 * Only allowed when status is DRAFT.
 */
exports.deletePaymentOrder = async (req, res) => {
  try {
    const paymentOrder = await PaymentOrder.findOne({
      _id: req.params.id,
      tenant: req.user.tenant,
    });

    if (!paymentOrder) {
      return sendError(res, {
        status: 404,
        code: "PAYMENT_ORDER_NOT_FOUND",
        message: "Orden de pago no encontrada",
      });
    }

    if (paymentOrder.status !== "DRAFT") {
      return sendError(res, {
        status: 409,
        code: "PAYMENT_ORDER_NOT_DELETABLE",
        message: "Solo se pueden eliminar órdenes de pago en estado borrador",
      });
    }

    await PaymentOrder.deleteOne({ _id: paymentOrder._id });

    return res.json({ message: "Orden de pago eliminada correctamente" });
  } catch (error) {
    return handleServerError(res, error, "Error al eliminar la orden de pago");
  }
};

// ── Apply Payment Order (DRAFT → PAID) ─────────────────────────────────

/**
 * POST /api/payment-orders/:id/apply
 * Validates all purchases, creates PAYMENT entries, updates purchase balances,
 * and marks the payment order as PAID. Uses a MongoDB transaction.
 */
exports.applyPaymentOrder = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    await session.withTransaction(async () => {
      const tenantId = req.user.tenant;

      const paymentOrder = await PaymentOrder.findOne({
        _id: req.params.id,
        tenant: tenantId,
      }).session(session);

      if (!paymentOrder) {
        throw new Error("PAYMENT_ORDER_NOT_FOUND");
      }

      if (paymentOrder.status !== "DRAFT") {
        throw new Error("INVALID_STATUS_TRANSITION");
      }

      // 1. Validate all referenced purchases exist and belong to tenant
      const purchaseIds = paymentOrder.items.map((item) => item.purchase);
      const purchases = await Purchase.find({
        _id: { $in: purchaseIds },
        tenant: tenantId,
      }).session(session);

      if (purchases.length !== purchaseIds.length) {
        throw new Error("PURCHASE_NOT_FOUND");
      }

      const purchaseMap = {};
      for (const p of purchases) {
        purchaseMap[String(p._id)] = p;
      }

      // 2. Validate each item amount doesn't exceed remaining balance
      for (const item of paymentOrder.items) {
        const purchase = purchaseMap[String(item.purchase)];
        if (!purchase) {
          throw new Error("PURCHASE_NOT_FOUND");
        }

        const remaining = purchase.total - purchase.paidAmount;
        if (item.amount > remaining + 0.01) {
          throw new Error("EXCEEDS_BALANCE");
        }
      }

      // 3. Create PAYMENT entries and update purchase balances
      const now = new Date();
      const todayString = now.toISOString().slice(0, 10);

      for (const item of paymentOrder.items) {
        const purchase = purchaseMap[String(item.purchase)];

        const isFullPayment = Math.abs(item.amount - (purchase.total - purchase.paidAmount)) < 0.01;
        purchase.paidAmount += item.amount;
        purchase.paymentStatus = isFullPayment ? "PAID" : "PARTIAL";
        if (isFullPayment || !purchase.paidAt) purchase.paidAt = now;
        if (!purchase.paymentMethod) purchase.paymentMethod = paymentOrder.paymentMethod;

        await purchase.save({ session });

        await SupplierAccountEntry.create(
          [
            {
              tenant: tenantId,
              supplier: paymentOrder.supplier,
              date: todayString,
              type: "PAYMENT",
              amount: item.amount,
              sign: -1,
              purchase: purchase._id,
              paymentMethod: paymentOrder.paymentMethod,
              reference: paymentOrder.reference || "",
              notes: `Pago agrupado orden ${paymentOrder._id}`,
              createdBy: req.user?._id,
            },
          ],
          { session },
        );
      }

      // 4. Mark payment order as PAID
      paymentOrder.status = "PAID";
      paymentOrder.paidAt = now;
      await paymentOrder.save({ session });

      // Fetch the hydrated result outside the transaction for the response
      res.locals.paymentOrderId = paymentOrder._id;
    });

    const hydrated = await PaymentOrder.findById(res.locals.paymentOrderId)
      .populate("supplier", "name company phone taxId")
      .populate("items.purchase", "date total paidAmount paymentStatus paymentCondition dueDate")
      .populate("createdBy", "fullName email");

    return res.json(hydrated);
  } catch (error) {
    if (error.message === "PAYMENT_ORDER_NOT_FOUND") {
      return sendError(res, {
        status: 404,
        code: "PAYMENT_ORDER_NOT_FOUND",
        message: "Orden de pago no encontrada",
      });
    }

    if (error.message === "INVALID_STATUS_TRANSITION") {
      return sendError(res, {
        status: 409,
        code: "INVALID_STATUS_TRANSITION",
        message: "Solo se pueden aplicar órdenes de pago en estado borrador",
      });
    }

    if (error.message === "PURCHASE_NOT_FOUND") {
      return sendError(res, {
        status: 404,
        code: "PURCHASE_NOT_FOUND",
        message: "Una o más compras no fueron encontradas",
      });
    }

    if (error.message === "EXCEEDS_BALANCE") {
      return sendError(res, {
        status: 400,
        code: "EXCEEDS_BALANCE",
        message: "El monto de un item excede el saldo pendiente de la compra",
      });
    }

    return handleServerError(res, error, "Error al aplicar la orden de pago");
  } finally {
    await session.endSession();
  }
};
