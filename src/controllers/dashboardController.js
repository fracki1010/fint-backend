const mongoose = require("mongoose");
const Client = require("../models/client.model");
const Order = require("../models/order.model");
const { Product } = require("../models/product.model");
const { Supply } = require("../models/supply.model");
const Purchase = require("../models/purchase.model");
const SupplierAccountEntry = require("../models/supplierAccountEntry.model");
const InventorySnapshot = require("../models/inventorySnapshot.model");
const Setting = require("../models/setting.model");
const StockMovement = require("../models/stockMovement.model");
const ClientAccountEntry = require("../models/clientAccountEntry.model");
const { handleServerError } = require("../utils/http");
const { getAgingReport } = require("../services/accountService");

const buildStartOfDay = (date = new Date()) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate());

const buildStartOfMonth = (date = new Date()) =>
  new Date(date.getFullYear(), date.getMonth(), 1);

const buildStartOfYear = (date = new Date()) =>
  new Date(date.getFullYear(), 0, 1);

const normalizeProductName = (value = "") => String(value).trim().toLowerCase();

const safeNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const roundTo = (value, digits = 2) => {
  const factor = 10 ** digits;
  return Math.round((safeNumber(value) + Number.EPSILON) * factor) / factor;
};

function parseDateInput(value, mode = "start") {
  if (!value) return null;

  const normalized = String(value).trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return null;
  }

  const date = new Date(`${normalized}T00:00:00.000Z`);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  if (mode === "end") {
    date.setUTCHours(23, 59, 59, 999);
  }

  return date;
}

const toIsoDate = (date) => date.toISOString().slice(0, 10);
const toUtcStartOfDay = (date) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

const sumOrderRevenue = (orders = []) =>
  orders.reduce((sum, order) => sum + safeNumber(order.totalAmount), 0);

const sumOrderCogs = (orders = [], productCostByName = new Map()) =>
  orders.reduce((sum, order) => {
    const orderCogs = (order.items || []).reduce((itemSum, item) => {
      const hasSnapshotCost =
        item.unitCostAtSale !== undefined && item.unitCostAtSale !== null;
      const key = normalizeProductName(item.product);
      const unitCost = hasSnapshotCost
        ? safeNumber(item.unitCostAtSale)
        : safeNumber(productCostByName.get(key));
      const qty = safeNumber(item.quantity);
      return itemSum + unitCost * qty;
    }, 0);

    return sum + orderCogs;
  }, 0);

exports.getSummary = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;
    const now = new Date();
    const startOfDay = buildStartOfDay(now);
    const startOfMonth = buildStartOfMonth(now);
    const startOfYear = buildStartOfYear(now);
    const startOfPreviousMonth = new Date(
      now.getFullYear(),
      now.getMonth() - 1,
      1,
    );

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
      productsForCostRaw,
      ordersForUniversalKpisRaw,
      clientFirstPurchaseRaw,
      suppliesRaw,
      supplierBalanceRaw,
      lastReceivedPurchaseRaw,
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
      Product.find({ tenant: tenantId }).select("name costPrice").lean(),
      Order.find({
        tenant: tenantId,
        salesStatus: { $ne: "Cancelada" },
        createdAt: { $gte: startOfYear },
      })
        .select("totalAmount items client createdAt")
        .lean(),
      Order.aggregate([
        {
          $match: {
            tenant: tenantId,
            salesStatus: { $ne: "Cancelada" },
            client: { $exists: true, $ne: null },
          },
        },
        {
          $group: {
            _id: "$client",
            firstPurchaseAt: { $min: "$createdAt" },
          },
        },
      ]),
      Supply.find({ tenant: tenantId, isActive: { $ne: false } })
        .select("name sku currentStock minStock unit")
        .sort({ name: 1 })
        .lean(),
      SupplierAccountEntry.aggregate([
        { $match: { tenant: tenantId } },
        { $group: { _id: null, balance: { $sum: { $multiply: ["$amount", "$sign"] } } } },
      ]),
      Purchase.findOne({ tenant: tenantId, status: "RECEIVED" })
        .sort({ receivedAt: -1 })
        .populate("supplier", "name company")
        .select("supplier total receivedAt items")
        .lean(),
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

    const productCostByName = new Map(
      productsForCostRaw.map((product) => [
        normalizeProductName(product.name),
        safeNumber(product.costPrice),
      ]),
    );

    const currentMonthOrders = ordersForUniversalKpisRaw.filter(
      (order) => order.createdAt >= startOfMonth,
    );
    const previousMonthOrders = ordersForUniversalKpisRaw.filter(
      (order) =>
        order.createdAt >= startOfPreviousMonth && order.createdAt < startOfMonth,
    );
    const todayOrders = ordersForUniversalKpisRaw.filter(
      (order) => order.createdAt >= startOfDay,
    );

    const salesTodayNet = sumOrderRevenue(todayOrders);
    const salesMonthNet = sumOrderRevenue(currentMonthOrders);
    const salesYearNet = sumOrderRevenue(ordersForUniversalKpisRaw);
    const previousMonthSalesNet = sumOrderRevenue(previousMonthOrders);

    const currentMonthCogs = sumOrderCogs(currentMonthOrders, productCostByName);
    const yearCogs = sumOrderCogs(ordersForUniversalKpisRaw, productCostByName);
    const grossProfitMonth = salesMonthNet - currentMonthCogs;
    const grossProfitYear = salesYearNet - yearCogs;

    const averageTicketMonthUniversal =
      currentMonthOrders.length > 0 ? salesMonthNet / currentMonthOrders.length : 0;
    const grossMarginPctMonth =
      salesMonthNet > 0 ? (grossProfitMonth / salesMonthNet) * 100 : 0;
    const grossMarginPctYear =
      salesYearNet > 0 ? (grossProfitYear / salesYearNet) * 100 : 0;
    const salesGrowthPctVsPreviousMonth =
      previousMonthSalesNet > 0
        ? ((salesMonthNet - previousMonthSalesNet) / previousMonthSalesNet) * 100
        : 0;

    const firstPurchaseByClient = new Map(
      clientFirstPurchaseRaw.map((entry) => [String(entry._id), entry.firstPurchaseAt]),
    );
    const clientsInCurrentMonth = new Set(
      currentMonthOrders
        .map((order) => (order.client ? String(order.client) : null))
        .filter(Boolean),
    );

    let newClientsThisMonth = 0;
    let returningClientsThisMonth = 0;

    clientsInCurrentMonth.forEach((clientId) => {
      const firstPurchaseAt = firstPurchaseByClient.get(clientId);

      if (firstPurchaseAt && firstPurchaseAt >= startOfMonth) {
        newClientsThisMonth += 1;
      } else {
        returningClientsThisMonth += 1;
      }
    });

    // ── Purchasing data ──────────────────────────────────────────────
    const lowStockSupplies = (suppliesRaw || [])
      .filter((s) => (s.currentStock || 0) <= (s.minStock || 0))
      .slice(0, 5)
      .map((s) => ({
        _id: s._id,
        name: s.name,
        sku: s.sku || null,
        currentStock: s.currentStock || 0,
        minStock: s.minStock || 0,
        unit: s.unit || "unidad",
      }));

    const totalPayables = roundTo(supplierBalanceRaw[0]?.balance || 0);

    const lastReceivedPurchase = lastReceivedPurchaseRaw
      ? {
          _id: lastReceivedPurchaseRaw._id,
          supplierName:
            typeof lastReceivedPurchaseRaw.supplier === "object" && lastReceivedPurchaseRaw.supplier
              ? lastReceivedPurchaseRaw.supplier.company || lastReceivedPurchaseRaw.supplier.name || "Proveedor"
              : "Proveedor",
          total: lastReceivedPurchaseRaw.total || 0,
          itemCount: (lastReceivedPurchaseRaw.items || []).length,
          receivedAt: lastReceivedPurchaseRaw.receivedAt,
        }
      : null;

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
      universalKpis: {
        salesNet: {
          today: roundTo(salesTodayNet),
          month: roundTo(salesMonthNet),
          year: roundTo(salesYearNet),
          previousMonth: roundTo(previousMonthSalesNet),
        },
        grossProfit: {
          month: roundTo(grossProfitMonth),
          year: roundTo(grossProfitYear),
        },
        grossMarginPct: {
          month: roundTo(grossMarginPctMonth),
          year: roundTo(grossMarginPctYear),
        },
        averageTicket: {
          month: roundTo(averageTicketMonthUniversal),
          orderCountMonth: currentMonthOrders.length,
        },
        growth: {
          salesMonthVsPreviousMonthPct: roundTo(salesGrowthPctVsPreviousMonth),
        },
        customers: {
          newThisMonth: newClientsThisMonth,
          returningThisMonth: returningClientsThisMonth,
        },
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
      purchasing: {
        lowStockSupplies,
        lowStockSuppliesCount: lowStockSupplies.length,
        totalPayables,
        lastReceivedPurchase,
      },
    });
  } catch (error) {
    return handleServerError(
      res,
      error,
      "Error al obtener el resumen del dashboard",
    );
  }
};

exports.getOptionalKpis = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;
    const now = new Date();
    const defaultStart = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    const startDate = parseDateInput(req.query?.startDate, "start") || defaultStart;
    const endDate = parseDateInput(req.query?.endDate, "end") || now;

    const [productsRaw, ordersRaw] = await Promise.all([
      Product.find({ tenant: tenantId, isActive: { $ne: false } })
        .select("name sku category categories costPrice stock")
        .lean(),
      Order.find({
        tenant: tenantId,
        salesStatus: { $ne: "Cancelada" },
        createdAt: { $gte: startDate, $lte: endDate },
      })
        .populate("client", "name phone")
        .select("createdAt totalAmount items client")
        .lean(),
    ]);

    const productByName = new Map(
      productsRaw.map((product) => [
        normalizeProductName(product.name),
        {
          name: product.name,
          sku: product.sku || null,
          costPrice: safeNumber(product.costPrice),
          category:
            product.category ||
            (Array.isArray(product.categories) ? product.categories[0] : null) ||
            "Sin categoria",
        },
      ]),
    );

    const salesByCategoryMap = new Map();
    const salesByHourMap = new Map();
    const salesByWeekdayMap = new Map();
    const productStatsMap = new Map();
    const clientStatsMap = new Map();

    let totalRevenue = 0;
    let totalCogs = 0;

    ordersRaw.forEach((order) => {
      const orderDate = new Date(order.createdAt);
      const hour = String(orderDate.getHours()).padStart(2, "0");
      const weekday = orderDate.toLocaleDateString("es-AR", { weekday: "short" });
      const clientId =
        typeof order.client === "object" && order.client
          ? String(order.client._id)
          : "sin-cliente";
      const clientName =
        typeof order.client === "object" && order.client
          ? order.client.name || order.client.phone || "Cliente"
          : "Cliente";

      const orderRevenue = safeNumber(order.totalAmount);
      totalRevenue += orderRevenue;

      salesByHourMap.set(hour, (salesByHourMap.get(hour) || 0) + orderRevenue);
      salesByWeekdayMap.set(
        weekday,
        (salesByWeekdayMap.get(weekday) || 0) + orderRevenue,
      );

      const currentClientStats = clientStatsMap.get(clientId) || {
        clientId: clientId === "sin-cliente" ? null : clientId,
        clientName,
        revenue: 0,
        orders: 0,
      };
      currentClientStats.revenue += orderRevenue;
      currentClientStats.orders += 1;
      clientStatsMap.set(clientId, currentClientStats);

      (order.items || []).forEach((item) => {
        const normalizedName = normalizeProductName(item.product);
        const product = productByName.get(normalizedName);
        const quantity = safeNumber(item.quantity);
        const unitPrice = safeNumber(item.price);
        const revenue = quantity * unitPrice;
        const hasSnapshotCost =
          item.unitCostAtSale !== undefined && item.unitCostAtSale !== null;
        const unitCost = hasSnapshotCost
          ? safeNumber(item.unitCostAtSale)
          : safeNumber(product?.costPrice);
        const cogs = quantity * unitCost;
        const grossProfit = revenue - cogs;
        const category = product?.category || "Sin categoria";

        totalCogs += cogs;
        salesByCategoryMap.set(
          category,
          (salesByCategoryMap.get(category) || 0) + revenue,
        );

        const currentProductStats = productStatsMap.get(normalizedName) || {
          productName: item.product || product?.name || "Producto",
          sku: product?.sku || null,
          category,
          quantitySold: 0,
          revenue: 0,
          grossProfit: 0,
          grossMarginPct: 0,
        };

        currentProductStats.quantitySold += quantity;
        currentProductStats.revenue += revenue;
        currentProductStats.grossProfit += grossProfit;
        currentProductStats.grossMarginPct =
          currentProductStats.revenue > 0
            ? (currentProductStats.grossProfit / currentProductStats.revenue) * 100
            : 0;

        productStatsMap.set(normalizedName, currentProductStats);
      });
    });

    const currentStockValue = productsRaw.reduce(
      (sum, product) => sum + safeNumber(product.stock) * safeNumber(product.costPrice),
      0,
    );

    const todaySnapshotDate = toUtcStartOfDay(now);
    await InventorySnapshot.findOneAndUpdate(
      { tenant: tenantId, snapshotDate: todaySnapshotDate },
      {
        $set: {
          stockValue: roundTo(currentStockValue),
          productCount: productsRaw.length,
        },
      },
      { upsert: true },
    );

    const snapshotStartDate = toUtcStartOfDay(startDate);
    const snapshotEndDate = toUtcStartOfDay(endDate);
    const snapshots = await InventorySnapshot.find({
      tenant: tenantId,
      snapshotDate: { $gte: snapshotStartDate, $lte: snapshotEndDate },
    })
      .select("snapshotDate stockValue")
      .sort({ snapshotDate: 1 })
      .lean();

    const snapshotAverageStockValue =
      snapshots.length > 0
        ? snapshots.reduce((sum, snapshot) => sum + safeNumber(snapshot.stockValue), 0) /
          snapshots.length
        : 0;
    const rotationBaseStockValue =
      snapshotAverageStockValue > 0 ? snapshotAverageStockValue : currentStockValue;
    const inventoryRotationRatio =
      rotationBaseStockValue > 0 ? totalCogs / rotationBaseStockValue : 0;
    const inventoryRotationMethod =
      snapshots.length > 0 ? "snapshot_average" : "current_stock_proxy";

    const periodDays = Math.max(
      1,
      Math.ceil((endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000)),
    );

    const salesByCategory = Array.from(salesByCategoryMap.entries())
      .map(([category, revenue]) => ({
        category,
        revenue: roundTo(revenue),
        sharePct: totalRevenue > 0 ? roundTo((revenue / totalRevenue) * 100, 1) : 0,
      }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 8);

    const salesByHour = Array.from(salesByHourMap.entries())
      .map(([hour, revenue]) => ({
        hour,
        revenue: roundTo(revenue),
      }))
      .sort((a, b) => Number(a.hour) - Number(b.hour));

    const salesByWeekday = Array.from(salesByWeekdayMap.entries())
      .map(([weekday, revenue]) => ({
        weekday,
        revenue: roundTo(revenue),
      }))
      .sort((a, b) => b.revenue - a.revenue);

    const topProductsByVolume = Array.from(productStatsMap.values())
      .sort((a, b) => b.quantitySold - a.quantitySold || b.revenue - a.revenue)
      .slice(0, 10)
      .map((item) => ({
        ...item,
        revenue: roundTo(item.revenue),
        grossProfit: roundTo(item.grossProfit),
        grossMarginPct: roundTo(item.grossMarginPct, 1),
      }));

    const topProductsByMargin = Array.from(productStatsMap.values())
      .sort((a, b) => b.grossProfit - a.grossProfit || b.grossMarginPct - a.grossMarginPct)
      .slice(0, 10)
      .map((item) => ({
        ...item,
        revenue: roundTo(item.revenue),
        grossProfit: roundTo(item.grossProfit),
        grossMarginPct: roundTo(item.grossMarginPct, 1),
      }));

    const topClients = Array.from(clientStatsMap.values())
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10)
      .map((item) => ({
        clientId: item.clientId,
        clientName: item.clientName,
        revenue: roundTo(item.revenue),
        orders: item.orders,
      }));

    return res.json({
      generatedAt: now,
      meta: {
        startDate: toIsoDate(startDate),
        endDate: toIsoDate(endDate),
        periodDays,
      },
      inventoryRotation: {
        ratio: roundTo(inventoryRotationRatio, 3),
        cogs: roundTo(totalCogs),
        averageStockValue: roundTo(rotationBaseStockValue),
        method: inventoryRotationMethod,
        snapshotCount: snapshots.length,
      },
      salesByCategory,
      salesByHour,
      salesByWeekday,
      topProductsByVolume,
      topProductsByMargin,
      topClients,
    });
  } catch (error) {
    return handleServerError(
      res,
      error,
      "Error al obtener metricas opcionales del dashboard",
    );
  }
};

exports.getDailySales = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;
    const days = Math.min(Math.max(parseInt(req.query.days) || 14, 1), 90);

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days + 1);
    startDate.setHours(0, 0, 0, 0);

    const sales = await Order.aggregate([
      {
        $match: {
          tenant: tenantId,
          createdAt: { $gte: startDate },
          salesStatus: { $ne: "Cancelada" },
        },
      },
      {
        $group: {
          _id: {
            year: { $year: "$createdAt" },
            month: { $month: "$createdAt" },
            day: { $dayOfMonth: "$createdAt" },
          },
          revenue: { $sum: "$totalAmount" },
          orders: { $sum: 1 },
          averageTicket: { $avg: "$totalAmount" },
        },
      },
      { $sort: { "_id.year": 1, "_id.month": 1, "_id.day": 1 } },
    ]);

    // Fill in missing days with zeroes
    const result = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      d.setHours(0, 0, 0, 0);

      const dayData = sales.find(
        (s) =>
          s._id.year === d.getFullYear() &&
          s._id.month === d.getMonth() + 1 &&
          s._id.day === d.getDate(),
      );

      result.push({
        date: d.toISOString().slice(0, 10),
        revenue: dayData?.revenue || 0,
        orders: dayData?.orders || 0,
        averageTicket: dayData?.averageTicket || 0,
      });
    }

    return res.json({ success: true, sales: result, days });
  } catch (error) {
    return handleServerError(res, error, "Error al obtener ventas diarias");
  }
};

exports.captureInventorySnapshot = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;
    const now = new Date();
    const snapshotDate = toUtcStartOfDay(now);
    const productsRaw = await Product.find({ tenant: tenantId, isActive: { $ne: false } })
      .select("stock costPrice")
      .lean();

    const stockValue = productsRaw.reduce(
      (sum, product) => sum + safeNumber(product.stock) * safeNumber(product.costPrice),
      0,
    );

    const snapshot = await InventorySnapshot.findOneAndUpdate(
      { tenant: tenantId, snapshotDate },
      {
        $set: {
          stockValue: roundTo(stockValue),
          productCount: productsRaw.length,
        },
      },
      {
        upsert: true,
        new: true,
      },
    ).lean();

    return res.status(201).json({
      snapshot: {
        date: toIsoDate(snapshot.snapshotDate),
        stockValue: roundTo(snapshot.stockValue),
        productCount: snapshot.productCount,
      },
    });
  } catch (error) {
    return handleServerError(
      res,
      error,
      "Error al capturar snapshot de inventario",
    );
  }
};

// ── Receivables Analytics (PR 2: Aging & Reporting) ──────────────────────

exports.getReceivables = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;

    // Get aging report summary
    const agingReport = await getAgingReport(tenantId);

    // Get total receivables from all pending CHARGE entries
    const receivablesAgg = await ClientAccountEntry.aggregate([
      {
        $match: {
          tenant: new mongoose.Types.ObjectId(tenantId),
          type: { $in: ["CHARGE", "DEBIT_NOTE"] },
          $or: [
            { status: { $in: ["pending", "partial"] } },
            { status: null },
          ],
        },
      },
      {
        $group: {
          _id: null,
          totalReceivables: {
            $sum: {
              $cond: {
                if: { $gt: ["$remainingAmount", 0] },
                then: "$remainingAmount",
                else: {
                  $subtract: [
                    "$amount",
                    { $sum: { $ifNull: ["$allocations.amount", []] } },
                  ],
                },
              },
            },
          },
          totalEntries: { $sum: 1 },
        },
      },
    ]);

    // Get top overdue clients (sorted by overdue amount)
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const topOverdueClients = await ClientAccountEntry.aggregate([
      {
        $match: {
          tenant: new mongoose.Types.ObjectId(tenantId),
          type: { $in: ["CHARGE", "DEBIT_NOTE"] },
          $or: [
            { status: { $in: ["pending", "partial"] } },
            { status: null },
          ],
          dueDate: { $exists: true, $ne: null, $lt: today },
        },
      },
      {
        $addFields: {
          effectiveRemaining: {
            $cond: {
              if: { $gt: ["$remainingAmount", 0] },
              then: "$remainingAmount",
              else: {
                $subtract: [
                  "$amount",
                  { $sum: { $ifNull: ["$allocations.amount", []] } },
                ],
              },
            },
          },
        },
      },
      {
        $group: {
          _id: "$client",
          overdueAmount: { $sum: "$effectiveRemaining" },
          overdueCount: { $sum: 1 },
          oldestDueDate: { $min: "$dueDate" },
        },
      },
      { $match: { overdueAmount: { $gt: 0 } } },
      { $sort: { overdueAmount: -1 } },
      { $limit: 5 },
      {
        $lookup: {
          from: "clients",
          localField: "_id",
          foreignField: "_id",
          as: "clientInfo",
        },
      },
      {
        $unwind: {
          path: "$clientInfo",
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $project: {
          clientId: "$_id",
          clientName: { $ifNull: ["$clientInfo.name", "Unknown"] },
          clientPhone: { $ifNull: ["$clientInfo.phone", ""] },
          overdueAmount: 1,
          overdueCount: 1,
          oldestDueDate: 1,
          daysOverdue: {
            $floor: {
              $divide: [
                { $subtract: [today, "$oldestDueDate"] },
                1000 * 60 * 60 * 24,
              ],
            },
          },
        },
      },
    ]);

    // Count clients at/near credit limit
    const clientsWithLimit = await Client.find({
      tenant: tenantId,
      creditLimit: { $gt: 0 },
    }).select("_id name creditLimit");

    const creditAlerts = [];
    for (const client of clientsWithLimit) {
      const balanceAgg = await ClientAccountEntry.aggregate([
        {
          $match: {
            tenant: new mongoose.Types.ObjectId(tenantId),
            client: client._id,
          },
        },
        {
          $group: {
            _id: null,
            balance: { $sum: { $multiply: ["$amount", "$sign"] } },
          },
        },
      ]);

      const balance = balanceAgg[0]?.balance || 0;
      const utilization = (balance / client.creditLimit) * 100;

      if (utilization >= 80) {
        creditAlerts.push({
          clientId: client._id,
          clientName: client.name,
          creditLimit: client.creditLimit,
          currentBalance: balance,
          utilizationPercentage: Math.round(utilization * 100) / 100,
          status: balance > client.creditLimit ? "over_limit" : "near_limit",
        });
      }
    }

    // Sort credit alerts by utilization (highest first)
    creditAlerts.sort((a, b) => b.utilizationPercentage - a.utilizationPercentage);

    return res.json({
      summary: {
        totalReceivables: receivablesAgg[0]?.totalReceivables || 0,
        totalEntries: receivablesAgg[0]?.totalEntries || 0,
        overdueAmount: agingReport.totals["1-30"] + agingReport.totals["31-60"] + 
                       agingReport.totals["61-90"] + agingReport.totals["90+"],
        currentAmount: agingReport.totals.current,
      },
      agingSummary: agingReport.totals,
      topOverdueClients,
      creditAlerts: creditAlerts.slice(0, 5),
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return handleServerError(res, error, "Error al obtener cuentas por cobrar");
  }
};
