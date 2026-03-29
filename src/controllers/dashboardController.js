const Client = require("../models/client.model");
const Order = require("../models/order.model");
const { Product } = require("../models/product.model");
const Setting = require("../models/setting.model");
const StockMovement = require("../models/stockMovement.model");
const { handleServerError } = require("../utils/http");

const buildStartOfDay = (date = new Date()) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate());

const buildStartOfMonth = (date = new Date()) =>
  new Date(date.getFullYear(), date.getMonth(), 1);

exports.getSummary = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;
    const now = new Date();
    const startOfDay = buildStartOfDay(now);
    const startOfMonth = buildStartOfMonth(now);

    const settings = await Setting.findOne({ tenant: tenantId }).lean();
    const lowStockThreshold = settings?.lowStockThreshold || 5;

    const [
      salesToday,
      salesMonth,
      collectedMonth,
      averageTicketMonth,
      operationsRaw,
      activeProducts,
      topProductsRaw,
      recentOrdersRaw,
      recentMovementsRaw,
      totalClients,
      activeClients,
      customersWithDebt,
      debtTotals,
    ] = await Promise.all([
      Order.aggregate([
        {
          $match: {
            tenant: tenantId,
            createdAt: { $gte: startOfDay },
            salesStatus: { $ne: "Cancelada" },
          },
        },
        { $group: { _id: null, value: { $sum: "$totalAmount" } } },
      ]),
      Order.aggregate([
        {
          $match: {
            tenant: tenantId,
            createdAt: { $gte: startOfMonth },
            salesStatus: { $ne: "Cancelada" },
          },
        },
        { $group: { _id: null, value: { $sum: "$totalAmount" } } },
      ]),
      Order.aggregate([
        {
          $match: {
            tenant: tenantId,
            createdAt: { $gte: startOfMonth },
            paymentStatus: "Pagado",
            salesStatus: { $ne: "Cancelada" },
          },
        },
        { $group: { _id: null, value: { $sum: "$totalAmount" } } },
      ]),
      Order.aggregate([
        {
          $match: {
            tenant: tenantId,
            createdAt: { $gte: startOfMonth },
            salesStatus: { $ne: "Cancelada" },
          },
        },
        {
          $group: {
            _id: null,
            totalAmount: { $sum: "$totalAmount" },
            totalOrders: { $sum: 1 },
          },
        },
      ]),
      Order.aggregate([
        { $match: { tenant: tenantId } },
        {
          $group: {
            _id: null,
            pendingOrders: {
              $sum: { $cond: [{ $eq: ["$salesStatus", "Pendiente"] }, 1, 0] },
            },
            confirmedOrders: {
              $sum: { $cond: [{ $eq: ["$salesStatus", "Confirmada"] }, 1, 0] },
            },
            paidOrders: {
              $sum: { $cond: [{ $eq: ["$paymentStatus", "Pagado"] }, 1, 0] },
            },
            deliveredOrders: {
              $sum: { $cond: [{ $eq: ["$deliveryStatus", "Entregada"] }, 1, 0] },
            },
            cancelledOrders: {
              $sum: { $cond: [{ $eq: ["$salesStatus", "Cancelada"] }, 1, 0] },
            },
            totalOrders: { $sum: 1 },
          },
        },
      ]),
      Product.find({ tenant: tenantId, isActive: { $ne: false } })
        .select("name sku stock minStock costPrice unitOfMeasure")
        .sort({ name: 1 })
        .lean(),
      Order.aggregate([
        { $match: { tenant: tenantId, salesStatus: { $ne: "Cancelada" } } },
        { $unwind: "$items" },
        {
          $group: {
            _id: "$items.productId",
            name: { $first: "$items.product" },
            quantitySold: { $sum: "$items.quantity" },
            revenue: { $sum: { $multiply: ["$items.quantity", "$items.price"] } },
          },
        },
        { $sort: { quantitySold: -1, revenue: -1 } },
        { $limit: 5 },
      ]),
      Order.find({ tenant: tenantId, salesStatus: { $ne: "Cancelada" } })
        .populate("client", "name phone")
        .sort({ createdAt: -1 })
        .limit(5)
        .lean(),
      StockMovement.find({ tenant: tenantId })
        .populate("product", "name sku")
        .sort({ createdAt: -1 })
        .limit(6)
        .lean(),
      Client.countDocuments({ tenant: tenantId }),
      Client.countDocuments({ tenant: tenantId, isActive: { $ne: false } }),
      Client.countDocuments({
        tenant: tenantId,
        isActive: { $ne: false },
        debt: { $gt: 0 },
      }),
      Client.aggregate([
        {
          $match: {
            tenant: tenantId,
            isActive: { $ne: false },
            debt: { $gt: 0 },
          },
        },
        {
          $group: {
            _id: null,
            totalDebt: { $sum: "$debt" },
          },
        },
      ]),
    ]);

    const lowStockCandidates = activeProducts.filter(
      (product) =>
        (product.stock || 0) <=
        (product.minStock && product.minStock > 0
          ? product.minStock
          : lowStockThreshold),
    );

    const lowStockProducts = lowStockCandidates
      .filter(
        Boolean,
      )
      .slice(0, 5)
      .map((product) => ({
        _id: product._id,
        name: product.name,
        sku: product.sku || null,
        stock: product.stock || 0,
        minStock:
          product.minStock && product.minStock > 0
            ? product.minStock
            : lowStockThreshold,
        unitOfMeasure: product.unitOfMeasure || "unidad",
      }));

    const stockValue = activeProducts.reduce(
      (sum, product) => sum + (product.stock || 0) * (product.costPrice || 0),
      0,
    );

    const topProductIds = topProductsRaw
      .map((item) => item._id)
      .filter(Boolean);
    const topProductDocuments = topProductIds.length
      ? await Product.find({ _id: { $in: topProductIds }, tenant: tenantId })
          .select("name sku")
          .lean()
      : [];
    const topProductMap = new Map(
      topProductDocuments.map((product) => [String(product._id), product]),
    );

    const recentOrders = recentOrdersRaw.map((order) => ({
      _id: order._id,
      orderNumber: order.orderNumber || null,
      clientName:
        typeof order.client === "object" && order.client
          ? order.client.name || order.client.phone || "Cliente sin nombre"
          : "Cliente",
      totalAmount: order.totalAmount || 0,
      status: order.status,
      salesStatus: order.salesStatus,
      paymentStatus: order.paymentStatus,
      deliveryStatus: order.deliveryStatus,
      createdAt: order.createdAt,
    }));

    const recentMovements = recentMovementsRaw.map((movement) => ({
      _id: movement._id,
      type: movement.type,
      productName:
        movement.product && typeof movement.product === "object"
          ? movement.product.name
          : "Producto",
      sku:
        movement.product && typeof movement.product === "object"
          ? movement.product.sku || null
          : null,
      quantity: movement.quantity,
      reason: movement.reason || movement.type,
      createdAt: movement.createdAt,
    }));

    return res.json({
      generatedAt: now,
      sales: {
        todaySales: salesToday[0]?.value || 0,
        monthSales: salesMonth[0]?.value || 0,
        collectedMonth: collectedMonth[0]?.value || 0,
        averageTicket:
          averageTicketMonth[0]?.totalOrders > 0
            ? averageTicketMonth[0].totalAmount / averageTicketMonth[0].totalOrders
            : 0,
        totalOrdersMonth: averageTicketMonth[0]?.totalOrders || 0,
      },
      operations: {
        pendingOrders: operationsRaw[0]?.pendingOrders || 0,
        confirmedOrders: operationsRaw[0]?.confirmedOrders || 0,
        paidOrders: operationsRaw[0]?.paidOrders || 0,
        deliveredOrders: operationsRaw[0]?.deliveredOrders || 0,
        cancelledOrders: operationsRaw[0]?.cancelledOrders || 0,
        totalOrders: operationsRaw[0]?.totalOrders || 0,
      },
      inventory: {
        totalProducts: activeProducts.length,
        lowStockCount: lowStockCandidates.length,
        stockValue,
        lowStockProducts,
      },
      customers: {
        totalClients,
        activeClients,
        customersWithDebt,
        totalDebt: debtTotals[0]?.totalDebt || 0,
      },
      topProducts: topProductsRaw.map((item) => {
        const productDoc = item._id ? topProductMap.get(String(item._id)) : null;

        return {
          productId: item._id || null,
          name: productDoc?.name || item.name || "Producto",
          sku: productDoc?.sku || null,
          quantitySold: item.quantitySold || 0,
          revenue: item.revenue || 0,
        };
      }),
      recentOrders,
      recentMovements,
    });
  } catch (error) {
    return handleServerError(
      res,
      error,
      "Error al obtener el resumen del dashboard",
    );
  }
};
