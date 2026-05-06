const mongoose = require("mongoose");
const StockMovement = require("../models/stockMovement.model");
const { Product } = require("../models/product.model");
const IdempotencyKey = require("../models/idempotencyKey.model");
const {
  createAndDispatchNotification,
} = require("../services/notificationService");
const { sendError, handleServerError } = require("../utils/http");

function parseDateValue(raw) {
  if (!raw) return null;
  const parsed = new Date(raw);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

const IDEMPOTENCY_SCOPE = "stock-movement:create";

const getIdempotencyKey = (req) => {
  const raw = req.headers?.["idempotency-key"];
  if (!raw || typeof raw !== "string") return null;
  const key = raw.trim();
  return key ? key : null;
};

const loadMovementPayload = async (tenantId, movementId) =>
  StockMovement.findOne({
    _id: movementId,
    tenant: tenantId,
  })
    .populate("product", "name sku")
    .populate("order", "client");

// Obtener todos los movimientos de stock
exports.getStockMovements = async (req, res) => {
  try {
    const {
      product,
      type,
      source,
      page = 1,
      limit = 20,
      datePreset,
      dateFrom,
      dateTo,
    } = req.query;
    const tenantId = req.user?.tenant;

    const parsedPage = Math.max(parseInt(page, 10) || 1, 1);
    const parsedLimit = Math.max(parseInt(limit, 10) || 20, 1);

    const filter = { tenant: tenantId };
    if (product) filter.product = product;
    if (type) filter.type = type;
    if (source) filter.source = source;

    let rangeStart = parseDateValue(dateFrom);
    let rangeEnd = parseDateValue(dateTo);

    if (!rangeStart && !rangeEnd && datePreset) {
      const now = new Date();
      const start = new Date(now);
      const end = new Date(now);

      end.setHours(23, 59, 59, 999);

      if (datePreset === "today") {
        start.setHours(0, 0, 0, 0);
        rangeStart = start;
        rangeEnd = end;
      } else {
        const days = parseInt(datePreset, 10);

        if ([7, 30, 90].includes(days)) {
          start.setHours(0, 0, 0, 0);
          start.setDate(start.getDate() - (days - 1));
          rangeStart = start;
          rangeEnd = end;
        }
      }
    }

    if (rangeStart || rangeEnd) {
      filter.createdAt = {};
      if (rangeStart) filter.createdAt.$gte = rangeStart;
      if (rangeEnd) filter.createdAt.$lte = rangeEnd;
    }

    const movements = await StockMovement.find(filter)
      .populate("product", "name sku unitOfMeasure")
      .populate("order", "client")
      .sort({ createdAt: -1 })
      .limit(parsedLimit)
      .skip((parsedPage - 1) * parsedLimit);

    const total = await StockMovement.countDocuments(filter);

    res.json({
      movements,
      totalPages: Math.ceil(total / parsedLimit),
      currentPage: parsedPage,
      total,
    });
  } catch (error) {
    return handleServerError(res, error, "Error al obtener movimientos");
  }
};

// Obtener un movimiento por ID
exports.getStockMovementById = async (req, res) => {
  try {
    const movement = await StockMovement.findOne({
      _id: req.params.id,
      tenant: req.user?.tenant,
    })
      .populate(
        "product",
        "name sku description price costPrice stock minStock category categories unitOfMeasure presentations createdAt updatedAt",
      )
      .populate({
        path: "order",
        populate: {
          path: "client",
          select: "name phone email company taxId address fiscalAddress notes",
        },
      });
    if (!movement) {
      return sendError(res, {
        status: 404,
        code: "MOVEMENT_NOT_FOUND",
        message: "Movimiento no encontrado",
      });
    }

    res.json({
      movement,
    });
  } catch (error) {
    return handleServerError(res, error, "Error al obtener el movimiento");
  }
};

// Crear un nuevo movimiento de stock
exports.createStockMovement = async (req, res) => {
  const session = await mongoose.startSession();
  let sessionClosed = false;
  const tenantId = req.user?.tenant;
  const idempotencyKey = getIdempotencyKey(req);

  try {
    if (idempotencyKey) {
      const existingKey = await IdempotencyKey.findOne({
        tenant: tenantId,
        scope: IDEMPOTENCY_SCOPE,
        key: idempotencyKey,
      }).lean();

      if (existingKey) {
        const replayMovement = await loadMovementPayload(
          tenantId,
          existingKey.resourceId,
        );
        if (replayMovement) {
          res.setHeader("Idempotent-Replayed", "true");
          return res.status(200).json(replayMovement);
        }
      }
    }

    session.startTransaction();
    const { product, type, quantity, reason, order, source, presentationName, presentationId, presentationEquivalentQty, presentationUnitCost } = req.body;

    // Obtener el producto para calcular stockBefore y stockAfter
    const prod = await Product.findOne({
      _id: product,
      tenant: tenantId,
      isActive: { $ne: false },
    }).session(session);
    if (!prod) {
      await session.abortTransaction();
      session.endSession();
      sessionClosed = true;
      return sendError(res, {
        status: 404,
        code: "PRODUCT_NOT_FOUND",
        message: "Producto no encontrado",
      });
    }

    const stockBefore = prod.stock;
    let stockAfter;

    if (type === "ENTRADA" || type === "AJUSTE") {
      stockAfter = stockBefore + quantity;
    } else if (type === "SALIDA" || type === "MERMA") {
      stockAfter = stockBefore - quantity;
      if (stockAfter < 0) {
        await session.abortTransaction();
        session.endSession();
        sessionClosed = true;
        return sendError(res, {
          status: 409,
          code: "INSUFFICIENT_STOCK",
          message: "Stock insuficiente",
        });
      }
    }

    // Actualizar el stock del producto
    prod.stock = stockAfter;
    await prod.save({ session });

    const newMovement = new StockMovement({
      tenant: tenantId,
      product,
      type,
      quantity,
      stockBefore,
      stockAfter,
      reason,
      order,
      source: source || "Dashboard",
      presentationName,
      presentationId,
      presentationEquivalentQty,
      presentationUnitCost,
    });

    await newMovement.save({ session });
    if (idempotencyKey) {
      await IdempotencyKey.create(
        [
          {
            tenant: tenantId,
            scope: IDEMPOTENCY_SCOPE,
            key: idempotencyKey,
            resourceType: "stock_movement",
            resourceId: newMovement._id,
          },
        ],
        { session },
      );
    }

    await session.commitTransaction();
    session.endSession();
    sessionClosed = true;

    await newMovement.populate("product", "name sku");
    await newMovement.populate("order", "client");

    await createAndDispatchNotification({
      userId: req.user?._id,
      type: type === "MERMA" ? "warning" : "info",
      title: "Movimiento de stock",
      message: `${type} de ${quantity} unidad(es) en ${prod.name}.`,
      metadata: { movementId: newMovement._id, productId: prod._id, type },
    });

    res.status(201).json(newMovement);
  } catch (error) {
    if (!sessionClosed) {
      try {
        await session.abortTransaction();
      } catch {
        // Sin acción: puede estar cerrada o no iniciada.
      }
      session.endSession();
      sessionClosed = true;
    }

    if (error?.code === 11000 && idempotencyKey) {
      const existingKey = await IdempotencyKey.findOne({
        tenant: tenantId,
        scope: IDEMPOTENCY_SCOPE,
        key: idempotencyKey,
      }).lean();

      if (existingKey) {
        const replayMovement = await loadMovementPayload(
          tenantId,
          existingKey.resourceId,
        );
        if (replayMovement) {
          res.setHeader("Idempotent-Replayed", "true");
          return res.status(200).json(replayMovement);
        }
      }
    }

    return handleServerError(res, error, "Error al crear el movimiento");
  }
};
