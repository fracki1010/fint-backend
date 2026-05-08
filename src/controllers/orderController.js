const mongoose = require("mongoose");
const Order = require("../models/order.model");
const { Product } = require("../models/product.model");
const Client = require("../models/client.model");
const Setting = require("../models/setting.model");
const StockMovement = require("../models/stockMovement.model");
const IdempotencyKey = require("../models/idempotencyKey.model");
const ClientAccountEntry = require("../models/clientAccountEntry.model");
const { checkCreditLimit } = require("../services/accountService");
const {
  createAndDispatchNotification,
} = require("../services/notificationService");
const voucherService = require("../services/voucherService");
const { HttpError, sendError, handleServerError } = require("../utils/http");

// Valid price tier values
const VALID_PRICE_TIERS = ["retail", "wholesale", "distributor"];

/**
 * Resolves the appropriate price for a product based on the client's price list tier.
 * Price resolution priority: tier price → retail tier → legacy price → 0
 *
 * @param {Object} product - The product document with priceTiers
 * @param {String} clientPriceList - The client's price list tier (retail/wholesale/distributor)
 * @returns {Number} The resolved price
 */
const resolveProductPrice = (product, clientPriceList = "retail") => {
  if (!product) return 0;

  // Validate the price tier, fallback to retail if invalid
  const tier = VALID_PRICE_TIERS.includes(clientPriceList) ? clientPriceList : "retail";

  // Try to get the tier-specific price
  const tierPrice = product.priceTiers?.[tier];
  if (tierPrice !== null && tierPrice !== undefined && !Number.isNaN(tierPrice)) {
    return Number(tierPrice);
  }

  // Fallback to retail tier price
  const retailPrice = product.priceTiers?.retail;
  if (retailPrice !== null && retailPrice !== undefined && !Number.isNaN(retailPrice)) {
    return Number(retailPrice);
  }

  // Fallback to legacy price field
  if (product.price !== null && product.price !== undefined && !Number.isNaN(product.price)) {
    return Number(product.price);
  }

  // Final fallback
  return 0;
};

/**
 * Gets the client's price list tier. Returns 'retail' as default if client not found
 * or has no priceList assigned.
 *
 * @param {String} clientId - The client ObjectId
 * @param {mongoose.ClientSession} session - Mongoose session for transaction
 * @returns {Promise<String>} The price list tier
 */
const getClientPriceList = async (clientId, session) => {
  if (!clientId) return "retail";

  try {
    const client = await Client.findById(clientId).select("priceList").session(session).lean();
    return client?.priceList || "retail";
  } catch (error) {
    // Log but don't fail - return default
    console.warn("Failed to get client price list, using default", { clientId, error: error.message });
    return "retail";
  }
};

const todayISO = () => new Date().toISOString().slice(0, 10);

const REVERSAL_TYPE = { CHARGE: "CREDIT_NOTE", PAYMENT: "DEBIT_NOTE", CREDIT_NOTE: "CHARGE", DEBIT_NOTE: "PAYMENT" };
const REVERSAL_SIGN = { CHARGE: -1, PAYMENT: 1, CREDIT_NOTE: 1, DEBIT_NOTE: -1 };

const createAccountCharge = async ({ tenantId, clientId, orderId, amount, actorUserId, session }) => {
  if (!clientId || !amount) return;

  // Calculate due date: created date + 30 days
  const today = new Date();
  const dueDate = new Date(today);
  dueDate.setDate(dueDate.getDate() + 30);

  await ClientAccountEntry.create([{
    tenant: tenantId,
    client: clientId,
    date: todayISO(),
    type: "CHARGE",
    amount,
    sign: 1,
    order: orderId,
    notes: "Cargo automático por venta",
    createdBy: actorUserId || null,
    dueDate,
    remainingAmount: amount,
    status: "pending",
  }], { session });
};

const createAccountPayment = async ({ tenantId, clientId, orderId, amount, paymentMethod, actorUserId, session }) => {
  if (!clientId || !amount) return;
  const existing = await ClientAccountEntry.findOne({ tenant: tenantId, order: orderId, type: "PAYMENT" }).session(session);
  if (existing) return;
  await ClientAccountEntry.create([{
    tenant: tenantId,
    client: clientId,
    date: todayISO(),
    type: "PAYMENT",
    amount,
    sign: -1,
    paymentMethod: paymentMethod || "",
    order: orderId,
    notes: "Cobro automático por venta pagada",
    createdBy: actorUserId || null,
  }], { session });
};

const reverseOrderAccountEntries = async ({ tenantId, orderId, actorUserId, session }) => {
  const entries = await ClientAccountEntry.find({ tenant: tenantId, order: orderId }).session(session);
  if (!entries.length) return;
  const reversals = entries.map((e) => ({
    tenant: tenantId,
    client: e.client,
    date: todayISO(),
    type: REVERSAL_TYPE[e.type] || "CREDIT_NOTE",
    amount: e.amount,
    sign: REVERSAL_SIGN[e.type] ?? -1,
    order: orderId,
    notes: `Reversión automática por cancelación`,
    createdBy: actorUserId || null,
  }));
  await ClientAccountEntry.create(reversals, { session, ordered: true });
};

const deriveLegacyStatus = ({
  salesStatus,
  paymentStatus,
  deliveryStatus,
}) => {
  if (salesStatus === "Cancelada") return "Cancelada";
  if (deliveryStatus === "Entregada") return "Entregado";
  if (paymentStatus === "Pagado") return "Pagado";
  if (salesStatus === "Confirmada") return "Confirmada";
  return "Pendiente";
};

const buildStatePatch = (payload, currentOrder) => {
  const nextSalesStatus = payload.salesStatus || currentOrder?.salesStatus || "Pendiente";
  const nextPaymentStatus =
    payload.paymentStatus || currentOrder?.paymentStatus || "Pendiente";
  const nextDeliveryStatus =
    payload.deliveryStatus || currentOrder?.deliveryStatus || "Pendiente";

  const patch = {
    salesStatus: nextSalesStatus,
    paymentStatus: nextPaymentStatus,
    deliveryStatus: nextDeliveryStatus,
    status: deriveLegacyStatus({
      salesStatus: nextSalesStatus,
      paymentStatus: nextPaymentStatus,
      deliveryStatus: nextDeliveryStatus,
    }),
  };

  if (payload.notes !== undefined) patch.notes = payload.notes;

  if (
    nextSalesStatus === "Confirmada" &&
    !currentOrder?.confirmedAt &&
    !payload.confirmedAt
  ) {
    patch.confirmedAt = new Date();
  }

  if (
    nextPaymentStatus === "Pagado" &&
    !currentOrder?.paidAt &&
    !payload.paidAt
  ) {
    patch.paidAt = new Date();
  }

  if (
    nextDeliveryStatus === "Entregada" &&
    !currentOrder?.deliveredAt &&
    !payload.deliveredAt
  ) {
    patch.deliveredAt = new Date();
  }

  if (
    nextSalesStatus === "Cancelada" &&
    !currentOrder?.cancelledAt &&
    !payload.cancelledAt
  ) {
    patch.cancelledAt = new Date();
  }

  return patch;
};

const resolveOrderItemsWithCostSnapshot = async (items, tenantId, session, clientPriceList = "retail") => {
  const normalizedItems = [];

  for (const rawItem of items || []) {
    const normalized = {
      product: rawItem.product,
      quantity: Number(rawItem.quantity) || 0,
      price: Number(rawItem.price) || 0,
      unitCostAtSale: 0,
      presentationId: rawItem.presentationId || null,
    };

    let matchedProduct = null;

    if (rawItem.productId) {
      matchedProduct = await Product.findOne({
        _id: rawItem.productId,
        tenant: tenantId,
      })
        .select("_id name costPrice price priceTiers")
        .session(session);
    }

    if (!matchedProduct && rawItem.product) {
      matchedProduct = await Product.findOne({
        name: rawItem.product,
        tenant: tenantId,
      })
        .select("_id name costPrice price priceTiers")
        .session(session);
    }

    if (matchedProduct) {
      normalized.productId = matchedProduct._id;
      normalized.product = matchedProduct.name;
      normalized.unitCostAtSale = Number(matchedProduct.costPrice) || 0;

      // Apply price tier resolution if no explicit price provided in request
      if (!rawItem.price && rawItem.price !== 0) {
        normalized.price = resolveProductPrice(matchedProduct, clientPriceList);
      }
    } else if (rawItem.productId) {
      normalized.productId = rawItem.productId;
    }

    normalizedItems.push(normalized);
  }

  return normalizedItems;
};

const applyStockForOrder = async (order, session, reasonPrefix, source, tenantId) => {
  for (const item of order.items) {
    let product = null;

    if (item.productId) {
      product = await Product.findOne({
        _id: item.productId,
        tenant: tenantId,
        isActive: { $ne: false },
      }).session(session);
    }

    if (!product) {
      product = await Product.findOne({
        name: item.product,
        tenant: tenantId,
        isActive: { $ne: false },
      }).session(session);
    }

    if (!product) continue;

    let qtyToDeduct = item.quantity;
    let presentationName;

    if (item.presentationId) {
      const presentation = product.presentations.id(item.presentationId);
      if (presentation) {
        qtyToDeduct = item.quantity * presentation.equivalentQty;
        presentationName = presentation.name;
      }
    }

    const stockBefore = product.stock;
    const stockAfter = stockBefore - qtyToDeduct;

    if (stockAfter < 0) {
      throw new HttpError(
        409,
        "INSUFFICIENT_STOCK",
        `Stock insuficiente para ${product.name}`,
      );
    }

    product.stock = stockAfter;
    await product.save({ session });

    await new StockMovement({
      tenant: tenantId,
      product: product._id,
      type: "SALIDA",
      quantity: qtyToDeduct,
      stockBefore,
      stockAfter,
      reason: `${reasonPrefix} #${order._id}`,
      order: order._id,
      source,
      presentationName,
    }).save({ session });
  }
};

const revertStockForOrder = async (order, session, source, tenantId) => {
  for (const item of order.items) {
    let product = null;

    if (item.productId) {
      product = await Product.findOne({
        _id: item.productId,
        tenant: tenantId,
        isActive: { $ne: false },
      }).session(session);
    }

    if (!product) {
      product = await Product.findOne({
        name: item.product,
        tenant: tenantId,
        isActive: { $ne: false },
      }).session(session);
    }

    if (!product) continue;

    let qtyToRevert = item.quantity;
    let presentationName;

    if (item.presentationId) {
      const presentation = product.presentations.id(item.presentationId);
      if (presentation) {
        qtyToRevert = item.quantity * presentation.equivalentQty;
        presentationName = presentation.name;
      }
    }

    const stockBefore = product.stock;
    const stockAfter = stockBefore + qtyToRevert;

    product.stock = stockAfter;
    await product.save({ session });

    await new StockMovement({
      tenant: tenantId,
      product: product._id,
      type: "ENTRADA",
      quantity: qtyToRevert,
      stockBefore,
      stockAfter,
      reason: `Reversion por cancelacion #${order._id}`,
      order: order._id,
      source,
      presentationName,
    }).save({ session });
  }
};

const populateOrderWithMovements = async (orderId, tenantId) => {
  const order = await Order.findOne({ _id: orderId, tenant: tenantId }).populate("client");
  const movements = await StockMovement.find({ order: orderId, tenant: tenantId })
    .populate("product", "name sku")
    .sort({ createdAt: -1 });

  return { order, movements };
};

const getOrderSettings = async (tenantId) => {
  const settings = await Setting.findOne({ tenant: tenantId });

  return {
    tenantId: tenantId || null,
    settingsId: settings?._id || null,
    orderPrefix: settings?.orderPrefix || "VTA",
    stockDeductionMoment: settings?.stockDeductionMoment || "delivery",
    allowDeliveryWithoutPayment: settings?.allowDeliveryWithoutPayment || false,
  };
};

const IDEMPOTENCY_SCOPES = {
  CREATE: "order:create",
  UPDATE: "order:update",
  DELETE: "order:delete",
};

const getIdempotencyKey = (req) => {
  const raw = req.headers?.["idempotency-key"];
  if (!raw || typeof raw !== "string") return null;
  const key = raw.trim();
  return key ? key : null;
};

const getReplayPayload = async ({ tenantId, resourceId }) => {
  if (!resourceId) return null;
  const payload = await populateOrderWithMovements(resourceId, tenantId);
  return payload.order || null;
};

const reserveOrderNumber = async (settingsSnapshot, session) => {
  const prefix = settingsSnapshot.orderPrefix || "VTA";
  const filter = settingsSnapshot.settingsId
    ? { _id: settingsSnapshot.settingsId }
    : { tenant: settingsSnapshot.tenantId };

  const settings = await Setting.findOneAndUpdate(
    filter,
    {
      $setOnInsert: {
        orderPrefix: prefix,
        tenant: settingsSnapshot.tenantId,
      },
      $inc: { orderSequence: 1 },
    },
    {
      returnDocument: "after",
      upsert: true,
      session,
    },
  );

  return `${settings.orderPrefix}-${String(settings.orderSequence).padStart(6, "0")}`;
};

// Obtener todas las órdenes
exports.getOrders = async (req, res) => {
  try {
    const userFilter = { tenant: req.user?.tenant };
    const hasPagination =
      req.query.page !== undefined || req.query.limit !== undefined;

    if (!hasPagination) {
      const orders = await Order.find(userFilter)
        .populate("client")
        .sort({ createdAt: -1 });
      return res.json(orders);
    }

    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    const skip = (page - 1) * limit;

    const [orders, total] = await Promise.all([
      Order.find(userFilter)
        .populate("client")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Order.countDocuments(userFilter),
    ]);

    const totalPages = Math.ceil(total / limit) || 1;

    return res.json({
      orders,
      totalPages,
      currentPage: page,
      total,
      hasNextPage: page < totalPages,
    });
  } catch (error) {
    return handleServerError(res, error, "Error al obtener órdenes");
  }
};

// Obtener una orden por ID
exports.getOrderById = async (req, res) => {
  try {
    const { order, movements } = await populateOrderWithMovements(
      req.params.id,
      req.user?.tenant,
    );

    if (!order) {
      return sendError(res, {
        status: 404,
        code: "ORDER_NOT_FOUND",
        message: "Orden no encontrada",
      });
    }

    res.json({ order, movements });
  } catch (error) {
    return handleServerError(res, error, "Error al obtener la orden");
  }
};

// Crear una nueva orden
exports.createOrder = async (req, res) => {
  const session = await mongoose.startSession();
  let sessionClosed = false;
  const tenantId = req.user?.tenant;
  const actorUserId = req.user?._id;
  const idempotencyKey = getIdempotencyKey(req);

  try {
    if (idempotencyKey) {
      const existingKey = await IdempotencyKey.findOne({
        tenant: tenantId,
        scope: IDEMPOTENCY_SCOPES.CREATE,
        key: idempotencyKey,
      }).lean();

      if (existingKey) {
        const replayOrder = await getReplayPayload({
          tenantId,
          resourceId: existingKey.resourceId,
        });
        if (replayOrder) {
          res.setHeader("Idempotent-Replayed", "true");
          return res.status(200).json(replayOrder);
        }
      }
    }

    session.startTransaction();

    const {
      client,
      items,
      totalAmount,
      status,
      imageUrl,
      source,
      notes,
      salesStatus,
      paymentStatus,
      deliveryStatus,
      paymentMethod,
      costCenter,
    } = req.body;
    const orderSettings = await getOrderSettings(tenantId);

    const nextSalesStatus =
      salesStatus || (status === "Cancelada" ? "Cancelada" : "Pendiente");
    const nextPaymentStatus =
      paymentStatus || (status === "Pagado" ? "Pagado" : "Pendiente");
    const nextDeliveryStatus =
      deliveryStatus || (status === "Entregado" ? "Entregada" : "Pendiente");

    // Get client's price list tier for price resolution
    const clientPriceList = await getClientPriceList(client, session);

    const normalizedItems = await resolveOrderItemsWithCostSnapshot(
      items,
      tenantId,
      session,
      clientPriceList,
    );

    const newOrder = new Order({
      tenant: tenantId,
      client,
      items: normalizedItems,
      totalAmount,
      orderNumber: await reserveOrderNumber(orderSettings, session),
      imageUrl,
      source: source || "Dashboard",
      notes,
      costCenter: costCenter || null,
      ...buildStatePatch(
        {
          salesStatus: nextSalesStatus,
          paymentStatus: nextPaymentStatus,
          deliveryStatus: nextDeliveryStatus,
          notes,
        },
        null,
      ),
    });

    const shouldApplyStockOnCreate =
      (orderSettings.stockDeductionMoment === "confirmation" &&
        newOrder.salesStatus === "Confirmada") ||
      (orderSettings.stockDeductionMoment === "delivery" &&
        newOrder.deliveryStatus === "Entregada");

    if (
      newOrder.deliveryStatus === "Entregada" &&
      !orderSettings.allowDeliveryWithoutPayment &&
      newOrder.paymentStatus !== "Pagado"
    ) {
      throw new HttpError(
        400,
        "DELIVERY_WITHOUT_PAYMENT_NOT_ALLOWED",
        "No se permite entregar una venta sin pago completo",
      );
    }

    // Check credit limit if the order will create a charge
    if (
      client &&
      totalAmount > 0 &&
      nextSalesStatus !== "Cancelada" &&
      nextPaymentStatus !== "Pagado"
    ) {
      const withinLimit = await checkCreditLimit(tenantId, client, totalAmount);
      if (!withinLimit) {
        throw new HttpError(
          400,
          "CREDIT_LIMIT_EXCEEDED",
          "El monto de la orden excede el límite de crédito del cliente",
        );
      }
    }

    if (shouldApplyStockOnCreate) {
      await applyStockForOrder(
        newOrder,
        session,
        orderSettings.stockDeductionMoment === "confirmation"
          ? "Confirmacion"
          : "Entrega",
        newOrder.source,
        tenantId,
      );
      newOrder.stockApplied = true;
      newOrder.stockAppliedAt = new Date();
    }

    await newOrder.save({ session });

    // Parallel: account charge + payment + idempotency key
    const postSaveOps = [];
    if (newOrder.client && newOrder.totalAmount > 0 && newOrder.salesStatus !== "Cancelada") {
      postSaveOps.push(createAccountCharge({ tenantId, clientId: newOrder.client, orderId: newOrder._id, amount: newOrder.totalAmount, actorUserId, session }));
      if (newOrder.paymentStatus === "Pagado") {
        postSaveOps.push(createAccountPayment({ tenantId, clientId: newOrder.client, orderId: newOrder._id, amount: newOrder.totalAmount, paymentMethod, actorUserId, session }));
      }
    }
    if (idempotencyKey) {
      postSaveOps.push(
        IdempotencyKey.create([{ tenant: tenantId, scope: IDEMPOTENCY_SCOPES.CREATE, key: idempotencyKey, resourceType: "order", resourceId: newOrder._id }], { session })
      );
    }
    await Promise.all(postSaveOps);

    await session.commitTransaction();
    session.endSession();
    sessionClosed = true;

    // Fire payload + vouchers + notification in parallel (outside transaction)
    const [payload] = await Promise.all([
      populateOrderWithMovements(newOrder._id, tenantId),
    ]);

    const { vouchersToGenerate } = req.body;
    // Fire-and-forget: voucher generation and notification don't block response
    const postOps = [];
    if (vouchersToGenerate && Array.isArray(vouchersToGenerate) && vouchersToGenerate.length > 0) {
      postOps.push(
        voucherService.generateVouchers(newOrder._id, vouchersToGenerate, actorUserId, { tenantId, skipIfExists: true })
          .catch((err) => console.error("Error generating vouchers:", err.message))
      );
    }
    if (actorUserId) {
      postOps.push(
        createAndDispatchNotification({
          userId: actorUserId, type: "success",
          title: "Nueva venta registrada",
          message: `Se creó la orden ${payload.order.orderNumber || payload.order._id}.`,
          metadata: { orderId: payload.order._id },
        }).catch(() => {})
      );
    }
    // Don't await - let them complete in background
    Promise.all(postOps).catch(() => {});

    // Include vouchers in response if generated
    // Vouchers are generated in background — return empty array, frontend can refetch
    res.status(201).json(payload.order.toObject ? payload.order.toObject() : payload.order);
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
        scope: IDEMPOTENCY_SCOPES.CREATE,
        key: idempotencyKey,
      }).lean();

      if (existingKey) {
        const replayOrder = await getReplayPayload({
          tenantId,
          resourceId: existingKey.resourceId,
        });
        if (replayOrder) {
          res.setHeader("Idempotent-Replayed", "true");
          return res.status(200).json(replayOrder);
        }
      }
    }

    return handleServerError(res, error, "Error al crear la orden");
  }
};

// Actualizar una orden
exports.updateOrder = async (req, res) => {
  const session = await mongoose.startSession();
  let sessionClosed = false;
  const tenantId = req.user?.tenant;
  const actorUserId = req.user?._id;
  const targetOrderId = req.params.id;
  const idempotencyKey = getIdempotencyKey(req);

  try {
    if (idempotencyKey) {
      const existingKey = await IdempotencyKey.findOne({
        tenant: tenantId,
        scope: IDEMPOTENCY_SCOPES.UPDATE,
        key: idempotencyKey,
      }).lean();

      if (existingKey) {
        if (String(existingKey.resourceId) !== String(targetOrderId)) {
          return sendError(res, {
            status: 409,
            code: "IDEMPOTENCY_KEY_REUSED",
            message: "La clave de idempotencia ya fue usada para otra orden",
          });
        }

        const replayOrder = await getReplayPayload({
          tenantId,
          resourceId: existingKey.resourceId,
        });
        if (replayOrder) {
          res.setHeader("Idempotent-Replayed", "true");
          return res.status(200).json(replayOrder);
        }
      }
    }

    session.startTransaction();

    const order = await Order.findOne({ _id: targetOrderId, tenant: tenantId }).session(
      session,
    );
    const orderSettings = await getOrderSettings(tenantId);

    if (!order) {
      await session.abortTransaction();
      session.endSession();
      return sendError(res, {
        status: 404,
        code: "ORDER_NOT_FOUND",
        message: "Orden no encontrada",
      });
    }

    const previousDeliveryStatus = order.deliveryStatus || "Pendiente";
    const previousSalesStatus = order.salesStatus || "Pendiente";
    const previousPaymentStatus = order.paymentStatus || "Pendiente";

    Object.assign(order, buildStatePatch(req.body, order));

    if (
      order.deliveryStatus === "Entregada" &&
      !orderSettings.allowDeliveryWithoutPayment &&
      order.paymentStatus !== "Pagado"
    ) {
      throw new HttpError(
        400,
        "DELIVERY_WITHOUT_PAYMENT_NOT_ALLOWED",
        "No se permite entregar una venta sin pago completo",
      );
    }

    if (
      orderSettings.stockDeductionMoment === "delivery" &&
      order.deliveryStatus === "Entregada" &&
      !order.stockApplied &&
      previousDeliveryStatus !== "Entregada"
    ) {
      await applyStockForOrder(
        order,
        session,
        "Entrega",
        order.source || "Dashboard",
        tenantId,
      );
      order.stockApplied = true;
      order.stockAppliedAt = new Date();
    }

    if (
      orderSettings.stockDeductionMoment === "confirmation" &&
      order.salesStatus === "Confirmada" &&
      !order.stockApplied &&
      previousSalesStatus !== "Confirmada"
    ) {
      await applyStockForOrder(
        order,
        session,
        "Confirmacion",
        order.source || "Dashboard",
        tenantId,
      );
      order.stockApplied = true;
      order.stockAppliedAt = new Date();
    }

    if (
      order.salesStatus === "Cancelada" &&
      order.stockApplied &&
      previousSalesStatus !== "Cancelada"
    ) {
      await revertStockForOrder(
        order,
        session,
        order.source || "Dashboard",
        tenantId,
      );
      order.stockApplied = false;
      order.stockAppliedAt = null;
    }

    await order.save({ session });

    if (order.client && order.totalAmount > 0) {
      const justPaid = order.paymentStatus === "Pagado" && previousPaymentStatus !== "Pagado" && previousSalesStatus !== "Cancelada";
      const justCancelled = order.salesStatus === "Cancelada" && previousSalesStatus !== "Cancelada";

      if (justCancelled) {
        await reverseOrderAccountEntries({ tenantId, orderId: order._id, actorUserId, session });
      } else if (justPaid) {
        await createAccountPayment({ tenantId, clientId: order.client, orderId: order._id, amount: order.totalAmount, paymentMethod: req.body.paymentMethod, actorUserId, session });
      }
    }

    if (idempotencyKey) {
      await IdempotencyKey.create(
        [
          {
            tenant: tenantId,
            scope: IDEMPOTENCY_SCOPES.UPDATE,
            key: idempotencyKey,
            resourceType: "order",
            resourceId: order._id,
          },
        ],
        { session },
      );
    }

    await session.commitTransaction();
    session.endSession();
    sessionClosed = true;

    const payload = await populateOrderWithMovements(order._id, tenantId);
    if (actorUserId) {
      try {
        await createAndDispatchNotification({
          userId: actorUserId,
          type: "info",
          title: "Orden actualizada",
          message: `Se actualizó la orden ${payload.order.orderNumber || payload.order._id}.`,
          metadata: { orderId: payload.order._id },
        });
      } catch {
        // Si falla la notificación no debe romper la operación ya confirmada.
      }
    }
    res.json(payload.order);
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
        scope: IDEMPOTENCY_SCOPES.UPDATE,
        key: idempotencyKey,
      }).lean();

      if (existingKey) {
        if (String(existingKey.resourceId) !== String(targetOrderId)) {
          return sendError(res, {
            status: 409,
            code: "IDEMPOTENCY_KEY_REUSED",
            message: "La clave de idempotencia ya fue usada para otra orden",
          });
        }

        const replayOrder = await getReplayPayload({
          tenantId,
          resourceId: existingKey.resourceId,
        });
        if (replayOrder) {
          res.setHeader("Idempotent-Replayed", "true");
          return res.status(200).json(replayOrder);
        }
      }
    }

    return handleServerError(res, error, "Error al actualizar la orden");
  }
};

// Eliminar una orden
exports.deleteOrder = async (req, res) => {
  const session = await mongoose.startSession();
  let sessionClosed = false;
  const tenantId = req.user?.tenant;
  const actorUserId = req.user?._id;
  const targetOrderId = req.params.id;
  const idempotencyKey = getIdempotencyKey(req);

  try {
    if (idempotencyKey) {
      const existingKey = await IdempotencyKey.findOne({
        tenant: tenantId,
        scope: IDEMPOTENCY_SCOPES.DELETE,
        key: idempotencyKey,
      }).lean();

      if (existingKey) {
        if (String(existingKey.resourceId) !== String(targetOrderId)) {
          return sendError(res, {
            status: 409,
            code: "IDEMPOTENCY_KEY_REUSED",
            message: "La clave de idempotencia ya fue usada para otra orden",
          });
        }

        res.setHeader("Idempotent-Replayed", "true");
        return res.json({ message: "Orden cancelada correctamente" });
      }
    }

    session.startTransaction();
    const order = await Order.findOne({
      _id: targetOrderId,
      tenant: tenantId,
    }).session(session);

    if (!order) {
      await session.abortTransaction();
      session.endSession();
      return sendError(res, {
        status: 404,
        code: "ORDER_NOT_FOUND",
        message: "Orden no encontrada",
      });
    }

    if (order.salesStatus !== "Cancelada") {
      Object.assign(order, buildStatePatch({ salesStatus: "Cancelada" }, order));

      if (order.stockApplied) {
        await revertStockForOrder(
          order,
          session,
          order.source || "Dashboard",
          tenantId,
        );
        order.stockApplied = false;
        order.stockAppliedAt = null;
      }

      await order.save({ session });
      await reverseOrderAccountEntries({ tenantId, orderId: order._id, actorUserId, session });
    }
    if (idempotencyKey) {
      await IdempotencyKey.create(
        [
          {
            tenant: tenantId,
            scope: IDEMPOTENCY_SCOPES.DELETE,
            key: idempotencyKey,
            resourceType: "order",
            resourceId: order._id,
          },
        ],
        { session },
      );
    }

    await session.commitTransaction();
    session.endSession();
    sessionClosed = true;

    try {
      await createAndDispatchNotification({
        userId: actorUserId,
        type: "warning",
        title: "Orden cancelada",
        message: `Se canceló la orden ${order.orderNumber || order._id}.`,
        metadata: { orderId: order._id },
      });
    } catch {
      // No interrumpimos la operación principal si falla la notificación.
    }
    res.json({ message: "Orden cancelada correctamente" });
  } catch (error) {
    if (!sessionClosed) {
      try {
        await session.abortTransaction();
      } catch {
        // Si ya estaba cerrada, no hacemos nada.
      }
      session.endSession();
      sessionClosed = true;
    }

    if (error?.code === 11000 && idempotencyKey) {
      const existingKey = await IdempotencyKey.findOne({
        tenant: tenantId,
        scope: IDEMPOTENCY_SCOPES.DELETE,
        key: idempotencyKey,
      }).lean();

      if (existingKey) {
        if (String(existingKey.resourceId) !== String(targetOrderId)) {
          return sendError(res, {
            status: 409,
            code: "IDEMPOTENCY_KEY_REUSED",
            message: "La clave de idempotencia ya fue usada para otra orden",
          });
        }

        res.setHeader("Idempotent-Replayed", "true");
        return res.json({ message: "Orden cancelada correctamente" });
      }
    }

    return handleServerError(res, error, "Error al cancelar la orden");
  }
};

exports.applyStockForOrder = applyStockForOrder;
exports.revertStockForOrder = revertStockForOrder;
exports.resolveProductPrice = resolveProductPrice;
exports.getClientPriceList = getClientPriceList;
