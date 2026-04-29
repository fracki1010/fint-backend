const mongoose = require("mongoose");

const Purchase = require("../models/purchase.model");
const { Supply } = require("../models/supply.model");
const SupplyMovement = require("../models/supplyMovement.model");
const SupplierAccountEntry = require("../models/supplierAccountEntry.model");
const { sendError, handleServerError } = require("../utils/http");

const mapPurchaseWithRelations = async (tenantId, id) =>
  Purchase.findOne({ _id: id, tenant: tenantId })
    .populate("supplier", "name company phone taxId")
    .populate("items.supply", "name sku unit");

exports.getPurchases = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;
    const purchases = await Purchase.find({ tenant: tenantId })
      .populate("supplier", "name company")
      .populate("items.supply", "name unit")
      .sort({ createdAt: -1 });

    return res.json(purchases);
  } catch (error) {
    return handleServerError(res, error, "Error al obtener compras");
  }
};

exports.getPurchaseById = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;
    const purchase = await mapPurchaseWithRelations(tenantId, req.params.id);

    if (!purchase) {
      return sendError(res, {
        status: 404,
        code: "PURCHASE_NOT_FOUND",
        message: "Compra no encontrada",
      });
    }

    return res.json(purchase);
  } catch (error) {
    return handleServerError(res, error, "Error al obtener compra");
  }
};

exports.createPurchase = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;

    const payload = {
      tenant: tenantId,
      supplier: req.body.supplierId,
      date: req.body.date,
      status: "DRAFT",
      paymentCondition: req.body.paymentCondition,
      subtotal: req.body.subtotal,
      tax: req.body.tax,
      total: req.body.total,
      notes: req.body.notes || "",
      items: req.body.items.map((item) => ({
        supply: item.supplyItemId,
        quantity: item.quantity,
        unitCost: item.unitCost,
        lineTotal: item.lineTotal,
      })),
      createdBy: req.user?._id,
    };

    const purchase = await Purchase.create(payload);
    const hydrated = await mapPurchaseWithRelations(tenantId, purchase._id);

    return res.status(201).json(hydrated);
  } catch (error) {
    return handleServerError(res, error, "Error al crear compra");
  }
};

exports.confirmPurchase = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;
    const purchase = await Purchase.findOne({ _id: req.params.id, tenant: tenantId });

    if (!purchase) {
      return sendError(res, {
        status: 404,
        code: "PURCHASE_NOT_FOUND",
        message: "Compra no encontrada",
      });
    }

    if (purchase.status !== "DRAFT") {
      return sendError(res, {
        status: 409,
        code: "INVALID_STATUS_TRANSITION",
        message: "Solo se puede confirmar una compra en estado DRAFT.",
      });
    }

    purchase.status = "CONFIRMED";
    await purchase.save();

    const hydrated = await mapPurchaseWithRelations(tenantId, purchase._id);

    return res.json(hydrated);
  } catch (error) {
    return handleServerError(res, error, "Error al confirmar compra");
  }
};

exports.receivePurchase = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    await session.withTransaction(async () => {
      const tenantId = req.user?.tenant;
      const purchase = await Purchase.findOne({ _id: req.params.id, tenant: tenantId })
        .populate("items.supply")
        .session(session);

      if (!purchase) throw new Error("PURCHASE_NOT_FOUND");
      if (purchase.status !== "CONFIRMED") throw new Error("INVALID_STATUS_TRANSITION");

      for (const item of purchase.items) {
        const supply = await Supply.findOne({
          _id: item.supply._id,
          tenant: tenantId,
          isActive: { $ne: false },
        }).session(session);

        if (!supply) throw new Error("SUPPLY_NOT_FOUND");

        const stockBefore = supply.currentStock;
        const stockAfter = stockBefore + Number(item.quantity);

        supply.currentStock = stockAfter;
        await supply.save({ session });

        await SupplyMovement.create(
          [
            {
              tenant: tenantId,
              supply: supply._id,
              type: "IN",
              quantity: Number(item.quantity),
              stockBefore,
              stockAfter,
              reason: `Recepcion de compra ${purchase._id}`,
              sourceType: "PURCHASE",
              sourceId: String(purchase._id),
              createdBy: req.user?._id,
            },
          ],
          { session },
        );
      }

      if (purchase.paymentCondition === "CREDIT") {
        await SupplierAccountEntry.create(
          [
            {
              tenant: tenantId,
              supplier: purchase.supplier,
              date: purchase.date,
              type: "CHARGE",
              amount: purchase.total,
              sign: 1,
              purchase: purchase._id,
              reference: `Compra ${purchase._id}`,
              notes: "Cargo automático por compra a crédito",
              createdBy: req.user?._id,
            },
          ],
          { session },
        );
      }

      purchase.status = "RECEIVED";
      purchase.receivedAt = new Date();
      await purchase.save({ session });

      const hydrated = await mapPurchaseWithRelations(tenantId, purchase._id);
      res.json(hydrated);
    });
  } catch (error) {
    if (error.message === "PURCHASE_NOT_FOUND") {
      return sendError(res, {
        status: 404,
        code: "PURCHASE_NOT_FOUND",
        message: "Compra no encontrada",
      });
    }
    if (error.message === "INVALID_STATUS_TRANSITION") {
      return sendError(res, {
        status: 409,
        code: "INVALID_STATUS_TRANSITION",
        message: "Solo se puede recibir una compra en estado CONFIRMED.",
      });
    }
    if (error.message === "SUPPLY_NOT_FOUND") {
      return sendError(res, {
        status: 404,
        code: "SUPPLY_NOT_FOUND",
        message: "Insumo no encontrado en items de compra.",
      });
    }

    return handleServerError(res, error, "Error al recibir compra");
  } finally {
    await session.endSession();
  }
};

exports.cancelPurchase = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;
    const purchase = await Purchase.findOne({ _id: req.params.id, tenant: tenantId });

    if (!purchase) {
      return sendError(res, {
        status: 404,
        code: "PURCHASE_NOT_FOUND",
        message: "Compra no encontrada",
      });
    }

    if (!["DRAFT", "CONFIRMED"].includes(purchase.status)) {
      return sendError(res, {
        status: 409,
        code: "INVALID_STATUS_TRANSITION",
        message: "Solo se puede cancelar una compra en estado DRAFT o CONFIRMED.",
      });
    }

    purchase.status = "CANCELLED";
    purchase.cancelledAt = new Date();
    await purchase.save();

    const hydrated = await mapPurchaseWithRelations(tenantId, purchase._id);

    return res.json(hydrated);
  } catch (error) {
    return handleServerError(res, error, "Error al cancelar compra");
  }
};
