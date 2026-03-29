const mongoose = require("mongoose");
const Order = require("../models/order.model");
const { Product } = require("../models/product.model");
const Setting = require("../models/setting.model");
const StockMovement = require("../models/stockMovement.model");
const {
  createAndDispatchNotification,
} = require("../services/notificationService");
const { HttpError, sendError, handleServerError } = require("../utils/http");

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

    const stockBefore = product.stock;
    const stockAfter = stockBefore - item.quantity;

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
      quantity: item.quantity,
      stockBefore,
      stockAfter,
      reason: `${reasonPrefix} #${order._id}`,
      order: order._id,
      source,
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

    const stockBefore = product.stock;
    const stockAfter = stockBefore + item.quantity;

    product.stock = stockAfter;
    await product.save({ session });

    await new StockMovement({
      tenant: tenantId,
      product: product._id,
      type: "ENTRADA",
      quantity: item.quantity,
      stockBefore,
      stockAfter,
      reason: `Reversion por cancelacion #${order._id}`,
      order: order._id,
      source,
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

  try {
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
    } = req.body;
    const tenantId = req.user?.tenant;
    const actorUserId = req.user?._id;
    const orderSettings = await getOrderSettings(tenantId);

    const nextSalesStatus =
      salesStatus || (status === "Cancelada" ? "Cancelada" : "Pendiente");
    const nextPaymentStatus =
      paymentStatus || (status === "Pagado" ? "Pagado" : "Pendiente");
    const nextDeliveryStatus =
      deliveryStatus || (status === "Entregado" ? "Entregada" : "Pendiente");

    const newOrder = new Order({
      tenant: tenantId,
      client,
      items,
      totalAmount,
      orderNumber: await reserveOrderNumber(orderSettings, session),
      imageUrl,
      source: source || "Dashboard",
      notes,
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

    await session.commitTransaction();
    session.endSession();

    const payload = await populateOrderWithMovements(newOrder._id, tenantId);
    if (actorUserId) {
      try {
        await createAndDispatchNotification({
          userId: actorUserId,
          type: "success",
          title: "Nueva venta registrada",
          message: `Se creó la orden ${payload.order.orderNumber || payload.order._id}.`,
          metadata: { orderId: payload.order._id },
        });
      } catch {
        // Si falla la notificación no debe romper la operación ya confirmada.
      }
    }
    res.status(201).json(payload.order);
  } catch (error) {
    await session.abortTransaction();
    session.endSession();

    return handleServerError(res, error, "Error al crear la orden");
  }
};

// Actualizar una orden
exports.updateOrder = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const tenantId = req.user?.tenant;
    const actorUserId = req.user?._id;
    const order = await Order.findOne({ _id: req.params.id, tenant: tenantId }).session(
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

    await session.commitTransaction();
    session.endSession();

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
    await session.abortTransaction();
    session.endSession();

    return handleServerError(res, error, "Error al actualizar la orden");
  }
};

// Eliminar una orden
exports.deleteOrder = async (req, res) => {
  const session = await mongoose.startSession();
  let sessionClosed = false;

  try {
    session.startTransaction();
    const tenantId = req.user?.tenant;
    const order = await Order.findOne({
      _id: req.params.id,
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
    }

    await session.commitTransaction();
    session.endSession();
    sessionClosed = true;

    try {
      await createAndDispatchNotification({
        userId: req.user?._id,
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

    return handleServerError(res, error, "Error al cancelar la orden");
  }
};
