const mongoose = require("mongoose");
const Receipt = require("../models/receipt.model");
const Purchase = require("../models/purchase.model");
const { receiveStock } = require("../services/costingService");
const { sendError, handleServerError } = require("../utils/http");

// Crear un remito para una orden de compra
exports.createReceipt = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    await session.withTransaction(async () => {
      const tenantId = req.user?.tenant;
      const purchaseId = req.params.purchaseId;

      const purchase = await Purchase.findOne({
        _id: purchaseId,
        tenant: tenantId,
      }).session(session);

      if (!purchase) {
        throw new Error("PURCHASE_NOT_FOUND");
      }

      // Legacy RECEIVED purchases can't get new receipts
      if (purchase.status === "RECEIVED") {
        throw new Error("PURCHASE_ALREADY_RECEIVED");
      }

      if (purchase.status !== "CONFIRMED") {
        throw new Error("PURCHASE_NOT_CONFIRMED");
      }

      const { date, notes, items } = req.body;

      if (!items || items.length === 0) {
        throw new Error("NO_ITEMS");
      }

      // Build a map of ordered quantities for validation
      const orderedMap = new Map();
      for (const item of purchase.items) {
        const key = item.product?.toString() || item.supply?.toString();
        orderedMap.set(key, {
          quantity: item.quantity,
          unitCost: item.unitCost,
        });
      }

      // Validate items and process stock
      const receiptItems = [];
      for (const item of items) {
        const productKey = item.product;
        const ordered = orderedMap.get(productKey);

        if (!ordered) {
          throw new Error(`ITEM_NOT_IN_PURCHASE: ${productKey}`);
        }

        const realQty = Number(item.quantity);
        const remittedQty = item.remittedQty != null ? Number(item.remittedQty) : realQty;

        // Remitted quantity cannot exceed ordered
        if (remittedQty > ordered.quantity) {
          throw new Error(`REMIT_EXCEEDS_ORDERED: ${productKey}`);
        }

        // Real received can differ from remitted (differences are normal)
        // But real cannot be negative or zero
        if (realQty <= 0) {
          throw new Error(`INVALID_REAL_QUANTITY: ${productKey}`);
        }

        const difference = Math.round((remittedQty - realQty) * 1000) / 1000;
        const lineTotal = Math.round(realQty * Number(item.unitCost) * 100) / 100;

        // Process stock via AVCO with REAL quantity
        await receiveStock({
          tenantId,
          productId: productKey,
          quantity: realQty,
          unitCost: Number(item.unitCost),
          presentationId: item.presentationId,
          purchaseId,
          reason: `Remito de compra ${purchaseId}`,
          session,
        });

        receiptItems.push({
          product: productKey,
          presentationId: item.presentationId || undefined,
          quantity: realQty,
          remittedQty: difference !== 0 ? remittedQty : undefined,
          differenceReason: difference !== 0 ? (item.differenceReason || "otro") : "",
          notes: item.notes || "",
          unitCost: Number(item.unitCost),
          lineTotal,
        });
      }

      const receipt = await Receipt.create(
        [{
          tenant: tenantId,
          purchase: purchaseId,
          date: date || new Date().toISOString().split("T")[0],
          notes: notes || "",
          items: receiptItems,
          createdBy: req.user?._id,
        }],
        { session },
      );

      // Add receipt reference to purchase
      purchase.receiptIds.push(receipt[0]._id);
      // Don't change purchase status — it stays CONFIRMED
      // User can keep adding partial receipts
      await purchase.save({ session });

      const populated = await Receipt.findById(receipt[0]._id)
        .populate("items.product", "name sku unitOfMeasure")
        .session(session);

      res.status(201).json(populated);
    });
  } catch (error) {
    if (error.message === "PURCHASE_NOT_FOUND") {
      return sendError(res, {
        status: 404,
        code: "PURCHASE_NOT_FOUND",
        message: "Orden de compra no encontrada",
      });
    }
    if (error.message === "PURCHASE_ALREADY_RECEIVED") {
      return sendError(res, {
        status: 409,
        code: "PURCHASE_ALREADY_RECEIVED",
        message: "La compra ya fue recibida completamente (legacy). No se pueden agregar más remitos.",
      });
    }
    if (error.message === "PURCHASE_NOT_CONFIRMED") {
      return sendError(res, {
        status: 409,
        code: "PURCHASE_NOT_CONFIRMED",
        message: "La orden de compra debe estar confirmada para recibir mercadería.",
      });
    }
    if (error.message === "NO_ITEMS") {
      return sendError(res, {
        status: 400,
        code: "NO_ITEMS",
        message: "El remito debe incluir al menos un item.",
      });
    }
    if (error.message?.startsWith("ITEM_NOT_IN_PURCHASE")) {
      return sendError(res, {
        status: 400,
        code: "ITEM_NOT_IN_PURCHASE",
        message: "Uno de los items no pertenece a la orden de compra.",
      });
    }
    if (error.message?.startsWith("REMIT_EXCEEDS_ORDERED")) {
      return sendError(res, {
        status: 400,
        code: "REMIT_EXCEEDS_ORDERED",
        message: "La cantidad remitida no puede superar la cantidad pedida.",
      });
    }
    if (error.message?.startsWith("INVALID_REAL_QUANTITY")) {
      return sendError(res, {
        status: 400,
        code: "INVALID_REAL_QUANTITY",
        message: "La cantidad real recibida debe ser mayor a cero.",
      });
    }
    return handleServerError(res, error, "Error al crear el remito");
  }
};

// Obtener remitos de una orden de compra
exports.getReceipts = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;
    const purchaseId = req.params.purchaseId;

    const purchase = await Purchase.findOne({
      _id: purchaseId,
      tenant: tenantId,
    });

    if (!purchase) {
      return sendError(res, {
        status: 404,
        code: "PURCHASE_NOT_FOUND",
        message: "Orden de compra no encontrada",
      });
    }

    const receipts = await Receipt.find({ purchase: purchaseId, tenant: tenantId })
      .populate("items.product", "name sku unitOfMeasure")
      .sort({ createdAt: -1 });

    res.json(receipts);
  } catch (error) {
    return handleServerError(res, error, "Error al obtener remitos");
  }
};
