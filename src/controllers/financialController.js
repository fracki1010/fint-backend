const Client = require("../models/client.model");
const Order = require("../models/order.model");
const { Product } = require("../models/product.model");
const { HttpError, handleServerError } = require("../utils/http");

const MS_IN_DAY = 24 * 60 * 60 * 1000;

const normalizeProductName = (value = "") => value.trim().toLowerCase();

const monthLabel = (date) =>
  date.toLocaleString("es-AR", { month: "short", timeZone: "UTC" });

function parseDateInput(value, mode = "start") {
  if (!value) return null;

  const normalized = String(value).trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new HttpError(
      400,
      "INVALID_DATE",
      "Fecha invalida. Usa el formato YYYY-MM-DD.",
    );
  }

  const date = new Date(`${normalized}T00:00:00.000Z`);

  if (Number.isNaN(date.getTime())) {
    throw new HttpError(
      400,
      "INVALID_DATE",
      "Fecha invalida. Usa el formato YYYY-MM-DD.",
    );
  }

  if (mode === "end") {
    date.setUTCHours(23, 59, 59, 999);
  }

  return date;
}

function buildDateRange(query, defaultStart, defaultEnd = new Date()) {
  const startDate = parseDateInput(query?.startDate, "start") || defaultStart;
  const endDate = parseDateInput(query?.endDate, "end") || defaultEnd;

  if (startDate > endDate) {
    throw new HttpError(
      400,
      "INVALID_DATE_RANGE",
      "startDate no puede ser mayor a endDate.",
    );
  }

  return { startDate, endDate };
}

function buildMonthsBack(count, now = new Date()) {
  const months = [];

  for (let i = count - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    months.push({
      key: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`,
      label: monthLabel(d),
      start: d,
      end: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)),
    });
  }

  return months;
}

function buildMonthsBetween(startDate, endDate) {
  const cursor = new Date(
    Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), 1),
  );
  const endCursor = new Date(
    Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), 1),
  );
  const months = [];

  while (cursor <= endCursor) {
    months.push({
      key: `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, "0")}`,
      label: monthLabel(cursor),
      start: new Date(cursor),
      end: new Date(
        Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1),
      ),
    });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  return months.length > 12 ? months.slice(months.length - 12) : months;
}

function buildFutureMonths(count, fromDate = new Date()) {
  const months = [];

  for (let i = 1; i <= count; i += 1) {
    const d = new Date(
      Date.UTC(fromDate.getUTCFullYear(), fromDate.getUTCMonth() + i, 1),
    );
    months.push({
      label: d.toLocaleString("es-AR", {
        month: "short",
        year: "2-digit",
        timeZone: "UTC",
      }),
    });
  }

  return months;
}

function buildProductByName(products = []) {
  const map = new Map();

  products.forEach((product) => {
    map.set(normalizeProductName(product.name), product);
  });

  return map;
}

function getProductCategory(product) {
  return product?.category || product?.categories?.[0] || "Sin categoria";
}

function collectAvailableCategories(products = []) {
  return Array.from(
    new Set(products.map((product) => getProductCategory(product)).filter(Boolean)),
  ).sort((a, b) => a.localeCompare(b));
}

function resolveScopedItems(items, productByName, categoryFilter = "") {
  const normalizedFilter = String(categoryFilter || "").trim().toLowerCase();
  const scoped = [];

  for (const item of items || []) {
    const product = productByName.get(normalizeProductName(item.product));
    const category = getProductCategory(product);
    const revenue = (item.quantity || 0) * (item.price || 0);
    const hasSnapshotCost =
      item.unitCostAtSale !== undefined && item.unitCostAtSale !== null;
    const unitCost = hasSnapshotCost ? item.unitCostAtSale : product?.costPrice || 0;
    const cogs = (item.quantity || 0) * unitCost;

    if (
      normalizedFilter &&
      !String(category || "")
        .trim()
        .toLowerCase()
        .includes(normalizedFilter)
    ) {
      continue;
    }

    scoped.push({
      productName: item.product || "Producto",
      quantity: item.quantity || 0,
      price: item.price || 0,
      category,
      revenue,
      cogs,
    });
  }

  return scoped;
}

function scopeOrdersByCategory(orders, productByName, categoryFilter = "") {
  return (orders || [])
    .map((order) => {
      const scopedItems = resolveScopedItems(order.items, productByName, categoryFilter);
      const scopedRevenue = scopedItems.reduce((sum, item) => sum + item.revenue, 0);
      const scopedCogs = scopedItems.reduce((sum, item) => sum + item.cogs, 0);

      return {
        ...order,
        scopedItems,
        scopedRevenue,
        scopedCogs,
      };
    })
    .filter((order) => order.scopedRevenue > 0);
}

function calculateCategoryRevenue(scopedOrders = []) {
  const totals = new Map();

  for (const order of scopedOrders) {
    for (const item of order.scopedItems || []) {
      totals.set(item.category, (totals.get(item.category) || 0) + item.revenue);
    }
  }

  const totalRevenue = Array.from(totals.values()).reduce((sum, value) => sum + value, 0);

  return Array.from(totals.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([name, value]) => ({
      name,
      share: totalRevenue > 0 ? Math.round((value / totalRevenue) * 100) : 0,
    }));
}

function calculateMonthlySeries(scopedOrders, months) {
  return months.map((month) => ({
    month: month.label,
    value: scopedOrders.reduce((sum, order) => {
      if (order.createdAt >= month.start && order.createdAt < month.end) {
        return sum + (order.scopedRevenue || 0);
      }

      return sum;
    }, 0),
  }));
}

function calculateKpis(scopedOrders, revenue) {
  const cogs = scopedOrders.reduce((sum, order) => sum + (order.scopedCogs || 0), 0);
  const opexProxy = revenue * 0.14 + cogs * 0.08;
  const ebitdaProxy = revenue - cogs - opexProxy;
  const margin = revenue > 0 ? (ebitdaProxy / revenue) * 100 : 0;

  return { cogs, opexProxy, ebitdaProxy, margin };
}

function formatMoneySigned(value) {
  const rounded = Math.abs(value || 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  return `${value >= 0 ? "+" : "-"}$${rounded}`;
}

function getFilterMeta(startDate, endDate, category) {
  return {
    startDate: startDate.toISOString().slice(0, 10),
    endDate: endDate.toISOString().slice(0, 10),
    category: category || "",
  };
}

const EXPANSION_MULTIPLIER = {
  EMEA: 1.08,
  APAC: 1.12,
  LATAM: 1.05,
};

function toSafeNumber(value, fallback = 0) {
  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : fallback;
}

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function parseScenarioFromBody(body = {}, defaults = null) {
  const fallback = defaults || {
    salesGrowth: 0,
    productionCosts: 0,
    marketExpansion: "LATAM",
  };

  const salesGrowthRaw =
    body?.salesGrowth == null ? fallback.salesGrowth : toSafeNumber(body.salesGrowth);
  const productionCostsRaw =
    body?.productionCosts == null
      ? fallback.productionCosts
      : toSafeNumber(body.productionCosts);
  const marketExpansionRaw = String(
    body?.marketExpansion || fallback.marketExpansion || "LATAM",
  ).toUpperCase();

  if (
    !Number.isFinite(salesGrowthRaw) ||
    salesGrowthRaw < -60 ||
    salesGrowthRaw > 120
  ) {
    throw new HttpError(
      400,
      "INVALID_SCENARIO",
      "salesGrowth debe estar entre -60 y 120.",
    );
  }

  if (
    !Number.isFinite(productionCostsRaw) ||
    productionCostsRaw < -60 ||
    productionCostsRaw > 120
  ) {
    throw new HttpError(
      400,
      "INVALID_SCENARIO",
      "productionCosts debe estar entre -60 y 120.",
    );
  }

  if (!Object.prototype.hasOwnProperty.call(EXPANSION_MULTIPLIER, marketExpansionRaw)) {
    throw new HttpError(
      400,
      "INVALID_SCENARIO",
      "marketExpansion debe ser EMEA, APAC o LATAM.",
    );
  }

  return {
    salesGrowth: Number(salesGrowthRaw.toFixed(1)),
    productionCosts: Number(productionCostsRaw.toFixed(1)),
    marketExpansion: marketExpansionRaw,
  };
}

function buildVolatilityByRisk(riskLevel) {
  if (riskLevel === "Alto") {
    return [
      {
        segment: "Sector Tecnologia",
        volatility: "Alta (21%)",
        impact: "Severo",
        action: "Cubrir Ahora",
      },
      {
        segment: "Logistica",
        volatility: "Media (9%)",
        impact: "Moderado",
        action: "Monitorear",
      },
      {
        segment: "Energia Global",
        volatility: "Alta (17%)",
        impact: "Severo",
        action: "Cubrir Ahora",
      },
    ];
  }

  if (riskLevel === "Bajo") {
    return [
      {
        segment: "Sector Tecnologia",
        volatility: "Media (10%)",
        impact: "Moderado",
        action: "Monitorear",
      },
      {
        segment: "Logistica",
        volatility: "Baja (3%)",
        impact: "Minimo",
        action: "Monitorear",
      },
      {
        segment: "Energia Global",
        volatility: "Media (7%)",
        impact: "Moderado",
        action: "Monitorear",
      },
    ];
  }

  return [
    {
      segment: "Sector Tecnologia",
      volatility: "Alta (18%)",
      impact: "Severo",
      action: "Cubrir Ahora",
    },
    {
      segment: "Logistica",
      volatility: "Baja (3%)",
      impact: "Minimo",
      action: "Monitorear",
    },
    {
      segment: "Energia Global",
      volatility: "Media (12%)",
      impact: "Moderado",
      action: "Monitorear",
    },
  ];
}

function computeProjectionSnapshot(monthlyRevenue, selectedScenario = null) {
  const total = monthlyRevenue.reduce((sum, item) => sum + item.value, 0);
  const average = monthlyRevenue.length > 0 ? total / monthlyRevenue.length : 0;
  const latest = monthlyRevenue[monthlyRevenue.length - 1]?.value || 0;
  const baseTrend = average > 0 ? ((latest - average) / average) * 100 : 0;

  const defaultScenario = {
    salesGrowth: Number((baseTrend / 2).toFixed(1)),
    productionCosts: Number((-Math.abs(baseTrend) / 3).toFixed(1)),
    marketExpansion: "LATAM",
  };

  const scenario = selectedScenario || defaultScenario;
  const expansionBase = EXPANSION_MULTIPLIER[scenario.marketExpansion] || 1;
  const horizonMonths = 12;
  const baseRate = clampNumber(baseTrend / 600, -0.08, 0.12);
  const scenarioRate = clampNumber(
    baseRate +
      scenario.salesGrowth / 800 -
      scenario.productionCosts / 1100 +
      (expansionBase - 1) / 3.5,
    -0.12,
    0.22,
  );

  const seedAmount = Math.max(latest || 0, average || 0, 1);
  const baseProjection = [];
  const scenarioProjection = [];
  let currentBase = seedAmount;
  let currentScenario = seedAmount;

  for (let i = 0; i < horizonMonths; i += 1) {
    const seasonal = 1 + 0.04 * Math.sin(((i + 1) / horizonMonths) * Math.PI * 2);

    currentBase = Math.max(0, currentBase * (1 + baseRate * seasonal));
    currentScenario = Math.max(0, currentScenario * (1 + scenarioRate * seasonal));

    baseProjection.push(currentBase);
    scenarioProjection.push(currentScenario);
  }

  const months = buildFutureMonths(horizonMonths);
  const comparison = months.map((month, index) => ({
    month: month.label,
    baseline: Number(baseProjection[index].toFixed(2)),
    scenario: Number(scenarioProjection[index].toFixed(2)),
  }));

  const baseMaxValue = Math.max(...baseProjection, ...scenarioProjection, 1);
  const forecastSeries = comparison.map((item) => ({
    month: item.month,
    value: clampNumber(
      Number(((item.scenario / baseMaxValue) * 100).toFixed(1)),
      4,
      100,
    ),
  }));

  const adjustedTotal = scenarioProjection.reduce((sum, item) => sum + item, 0);
  const adjustedAverage = scenarioProjection.length > 0 ? adjustedTotal / scenarioProjection.length : 0;
  const adjustedLatest = scenarioProjection[scenarioProjection.length - 1] || 0;
  const adjustedTrend =
    adjustedAverage > 0
      ? ((adjustedLatest - adjustedAverage) / adjustedAverage) * 100
      : 0;
  const riskScore = adjustedTrend - scenario.productionCosts * 0.35;
  const riskLevel = riskScore < -8 ? "Alto" : riskScore < 4 ? "Moderado" : "Bajo";

  return {
    whatIf: scenario,
    forecastSeries,
    projectionComparison: comparison,
    targetLiquidity: {
      amount: adjustedLatest * 2.4,
      baselineDelta: adjustedLatest - adjustedAverage,
    },
    riskAssessment: {
      label: riskLevel,
      level: riskLevel === "Alto" ? 4 : riskLevel === "Moderado" ? 3 : 2,
      description:
        riskLevel === "Alto"
          ? "La volatilidad proyectada puede tensionar la liquidez en el proximo trimestre."
          : riskLevel === "Moderado"
            ? "El escenario proyectado se mantiene estable con riesgo controlable."
            : "La tendencia favorece liquidez saludable con riesgo bajo.",
    },
    marketVolatility: buildVolatilityByRisk(riskLevel),
  };
}

exports.getOverview = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;
    const now = new Date();
    const oneYearAgo = new Date(now.getTime() - 365 * MS_IN_DAY);
    const { startDate, endDate } = buildDateRange(req.query, oneYearAgo, now);
    const category = String(req.query?.category || "").trim();
    const months = buildMonthsBack(6, endDate);
    const currentMonth = months[months.length - 1];
    const previousMonth = months[months.length - 2];

    const [products, orders, recentOrders] = await Promise.all([
      Product.find({ tenant: tenantId })
        .select("name category categories costPrice")
        .lean(),
      Order.find({
        tenant: tenantId,
        salesStatus: { $ne: "Cancelada" },
        createdAt: { $gte: startDate, $lte: endDate },
      })
        .select("createdAt totalAmount paymentStatus salesStatus items")
        .sort({ createdAt: -1 })
        .lean(),
      Order.find({
        tenant: tenantId,
        createdAt: { $gte: startDate, $lte: endDate },
      })
        .populate("client", "name phone")
        .sort({ createdAt: -1 })
        .limit(20)
        .lean(),
    ]);

    const productByName = buildProductByName(products);
    const scopedOrders = scopeOrdersByCategory(orders, productByName, category);
    const scopedRecentOrders = scopeOrdersByCategory(recentOrders, productByName, category).slice(
      0,
      5,
    );

    const revenue = scopedOrders.reduce((sum, order) => sum + order.scopedRevenue, 0);
    const { cogs, opexProxy, margin } = calculateKpis(scopedOrders, revenue);
    const monthlySeries = calculateMonthlySeries(scopedOrders, months);
    const currentMonthRevenue =
      monthlySeries.find((m) => m.month === currentMonth.label)?.value || 0;
    const previousMonthRevenue =
      monthlySeries.find((m) => m.month === previousMonth.label)?.value || 0;
    const monthDeltaPct =
      previousMonthRevenue > 0
        ? ((currentMonthRevenue - previousMonthRevenue) / previousMonthRevenue) * 100
        : 0;

    const pendingCount = scopedOrders.filter(
      (order) => order.paymentStatus !== "Pagado",
    ).length;
    const salesByCategory = calculateCategoryRevenue(scopedOrders).slice(0, 4);
    const availableCategories = collectAvailableCategories(products);

    const recentTransactions = scopedRecentOrders.map((order) => ({
      id: String(order._id),
      recipient:
        typeof order.client === "object" && order.client
          ? order.client.name || order.client.phone || "Cliente"
          : "Cliente",
      date: new Date(order.createdAt).toLocaleDateString("es-AR", {
        month: "short",
        day: "2-digit",
        year: "numeric",
      }),
      status:
        order.salesStatus === "Cancelada"
          ? "Observado"
          : order.paymentStatus === "Pagado"
            ? "Verificado"
            : "Pendiente",
      amount: formatMoneySigned(order.scopedRevenue || 0),
    }));

    const systemInsights = [
      {
        id: "INS-REVENUE",
        title: "Desviacion de Ingresos",
        description:
          monthDeltaPct < 0
            ? "Los ingresos del mes actual estan por debajo del mes anterior. Revisar conversion y churn."
            : "La tendencia de ingresos se mantiene estable. Continuar monitoreo operativo.",
        severity: "warning",
      },
      {
        id: "INS-PAYMENTS",
        title: "Seguimiento de Cobros",
        description:
          pendingCount > 0
            ? `${pendingCount} ordenes siguen pendientes de cobro y requieren seguimiento.`
            : "No se detectaron ordenes pendientes de cobro.",
        severity: pendingCount > 3 ? "danger" : "warning",
      },
    ];

    return res.json({
      generatedAt: now,
      meta: getFilterMeta(startDate, endDate, category),
      availableCategories,
      kpis: [
        {
          label: "Ingresos Totales",
          value: revenue,
          delta: monthDeltaPct,
          tone: monthDeltaPct >= 0 ? "positive" : "negative",
        },
        {
          label: "Gastos Operativos",
          value: opexProxy + cogs,
          delta: revenue > 0 ? ((opexProxy + cogs) / revenue) * 100 : 0,
          tone: "negative",
        },
        {
          label: "Margen Neto",
          value: margin,
          delta: margin,
          tone: margin >= 30 ? "neutral" : "warning",
        },
      ],
      monthlyRevenue: monthlySeries,
      salesByCategory,
      recentTransactions,
      systemInsights,
    });
  } catch (error) {
    return handleServerError(res, error, "Error al obtener financial overview");
  }
};

exports.getAccounting = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;
    const now = new Date();
    const yearStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
    const { startDate, endDate } = buildDateRange(req.query, yearStart, now);
    const category = String(req.query?.category || "").trim();

    const [products, clients, orders] = await Promise.all([
      Product.find({ tenant: tenantId })
        .select("name category categories costPrice stock")
        .lean(),
      Client.find({ tenant: tenantId, isActive: { $ne: false } })
        .select("debt")
        .lean(),
      Order.find({ tenant: tenantId, createdAt: { $gte: startDate, $lte: endDate } })
        .populate("client", "name phone")
        .sort({ createdAt: -1 })
        .limit(120)
        .lean(),
    ]);

    const productByName = buildProductByName(products);
    const scopedOrders = scopeOrdersByCategory(orders, productByName, category);
    const activeScopedOrders = scopedOrders.filter(
      (order) => order.salesStatus !== "Cancelada",
    );

    const revenue = activeScopedOrders.reduce(
      (sum, order) => sum + order.scopedRevenue,
      0,
    );
    const collected = activeScopedOrders
      .filter((order) => order.paymentStatus === "Pagado")
      .reduce((sum, order) => sum + order.scopedRevenue, 0);
    const receivables = Math.max(0, revenue - collected);
    const { cogs, opexProxy, ebitdaProxy } = calculateKpis(activeScopedOrders, revenue);

    const filteredProducts = category
      ? products.filter((product) =>
          getProductCategory(product)
            .toLowerCase()
            .includes(category.toLowerCase()),
        )
      : products;
    const stockValue = filteredProducts.reduce(
      (sum, product) => sum + (product.stock || 0) * (product.costPrice || 0),
      0,
    );

    const totalDebt = clients.reduce((sum, client) => sum + (client.debt || 0), 0);
    const accruedExpenses = opexProxy * 0.35;
    const totalAssets = stockValue + receivables + collected;
    const totalLiabilities = totalDebt + accruedExpenses;
    const equity = totalAssets - totalLiabilities;

    const availableCategories = collectAvailableCategories(products);
    const ledgerRows = scopedOrders.slice(0, 25).map((order) => ({
      date: new Date(order.createdAt).toLocaleDateString("es-AR", {
        month: "short",
        day: "2-digit",
        year: "numeric",
      }),
      description:
        (order.scopedItems && order.scopedItems[0]?.productName) ||
        order.orderNumber ||
        "Operacion comercial",
      category: order.source === "WhatsApp" ? "Ventas" : "Operativo",
      refId: order.orderNumber || `#${String(order._id).slice(-6)}`,
      debit:
        order.paymentStatus === "Pagado"
          ? "—"
          : `$${order.scopedRevenue.toLocaleString("en-US", { maximumFractionDigits: 2 })}`,
      credit:
        order.paymentStatus === "Pagado"
          ? `$${order.scopedRevenue.toLocaleString("en-US", { maximumFractionDigits: 2 })}`
          : "—",
      status:
        order.salesStatus === "Cancelada"
          ? "Observado"
          : order.paymentStatus === "Pagado"
            ? "Conciliado"
            : "Pendiente",
    }));

    return res.json({
      generatedAt: now,
      meta: getFilterMeta(startDate, endDate, category),
      availableCategories,
      balanceSummary: [
        { label: "Activos Totales", value: totalAssets, delta: 4.2 },
        { label: "Pasivos Totales", value: totalLiabilities, delta: -1.8 },
        { label: "Patrimonio", value: equity, delta: 0 },
      ],
      incomeStatement: {
        netRevenueYtd: revenue,
        grossMargin: revenue > 0 ? ((revenue - cogs) / revenue) * 100 : 0,
        operatingExpenses: opexProxy,
        ebitdaProxy,
      },
      ledgerRows,
    });
  } catch (error) {
    return handleServerError(res, error, "Error al obtener accounting");
  }
};

exports.getProductAnalysis = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;
    const now = new Date();
    const twentyEightDaysAgo = new Date(now.getTime() - 28 * MS_IN_DAY);
    const { startDate, endDate } = buildDateRange(req.query, twentyEightDaysAgo, now);
    const category = String(req.query?.category || "").trim();

    const [products, orders] = await Promise.all([
      Product.find({ tenant: tenantId })
        .select("name category categories costPrice")
        .lean(),
      Order.find({
        tenant: tenantId,
        salesStatus: { $ne: "Cancelada" },
        createdAt: { $gte: startDate, $lte: endDate },
      })
        .select("createdAt items")
        .lean(),
    ]);

    const productByName = buildProductByName(products);
    const scopedOrders = scopeOrdersByCategory(orders, productByName, category);
    const availableCategories = collectAvailableCategories(products);

    const matrix = Array.from({ length: 4 }, () => Array.from({ length: 7 }, () => 0));
    const productStats = new Map();

    for (const order of scopedOrders) {
      const dayDiff = Math.floor(
        (now.getTime() - new Date(order.createdAt).getTime()) / MS_IN_DAY,
      );
      const weekIndex = Math.floor(dayDiff / 7);

      if (weekIndex >= 0 && weekIndex < 4) {
        const weekday = new Date(order.createdAt).getDay();
        matrix[3 - weekIndex][weekday] += 1;
      }

      for (const item of order.scopedItems || []) {
        const key = normalizeProductName(item.productName);
        const existing = productStats.get(key) || {
          name: item.productName || "Producto",
          category: item.category || "General",
          quantity: 0,
          revenue: 0,
          cogs: 0,
        };

        existing.quantity += item.quantity || 0;
        existing.revenue += item.revenue || 0;
        existing.cogs += item.cogs || 0;

        productStats.set(key, existing);
      }
    }

    const maxHeat = Math.max(...matrix.flat(), 1);
    const heatmap = matrix.map((row) =>
      row.map((value) => Math.round((value / maxHeat) * 100)),
    );
    const salesDistribution = calculateCategoryRevenue(scopedOrders).slice(0, 3);

    const topProducts = Array.from(productStats.values())
      .map((item) => {
        const profit = item.revenue - item.cogs;
        const netMargin = item.revenue > 0 ? (profit / item.revenue) * 100 : 0;
        const roi = item.cogs > 0 ? profit / item.cogs : 0;

        return {
          name: item.name,
          category: item.category,
          netMargin,
          roi,
          volume: item.quantity,
          status: roi >= 8 ? "Optimo" : roi >= 3 ? "Escalando" : "Revisar",
        };
      })
      .sort((a, b) => b.roi - a.roi)
      .slice(0, 10);

    return res.json({
      generatedAt: now,
      meta: getFilterMeta(startDate, endDate, category),
      availableCategories,
      salesDistribution,
      heatmap,
      topProducts,
    });
  } catch (error) {
    return handleServerError(res, error, "Error al obtener product analysis");
  }
};

exports.getProjections = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;
    const now = new Date();
    const defaultStart = new Date(now.getTime() - 365 * MS_IN_DAY);
    const { startDate, endDate } = buildDateRange(req.query, defaultStart, now);
    const category = String(req.query?.category || "").trim();
    const months = buildMonthsBetween(startDate, endDate);

    const [products, orders] = await Promise.all([
      Product.find({ tenant: tenantId })
        .select("name category categories costPrice")
        .lean(),
      Order.find({
        tenant: tenantId,
        salesStatus: { $ne: "Cancelada" },
        createdAt: { $gte: months[0].start, $lte: endDate },
      })
        .select("createdAt items")
        .lean(),
    ]);

    const productByName = buildProductByName(products);
    const scopedOrders = scopeOrdersByCategory(orders, productByName, category);
    const availableCategories = collectAvailableCategories(products);
    const monthlyRevenue = calculateMonthlySeries(scopedOrders, months);
    const projectionSnapshot = computeProjectionSnapshot(monthlyRevenue);

    return res.json({
      generatedAt: now,
      meta: getFilterMeta(startDate, endDate, category),
      availableCategories,
      ...projectionSnapshot,
    });
  } catch (error) {
    return handleServerError(res, error, "Error al obtener projections");
  }
};

exports.applyProjectionsModel = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;
    const now = new Date();
    const defaultStart = new Date(now.getTime() - 365 * MS_IN_DAY);
    const { startDate, endDate } = buildDateRange(req.query, defaultStart, now);
    const category = String(req.query?.category || "").trim();
    const months = buildMonthsBetween(startDate, endDate);

    const [products, orders] = await Promise.all([
      Product.find({ tenant: tenantId })
        .select("name category categories costPrice")
        .lean(),
      Order.find({
        tenant: tenantId,
        salesStatus: { $ne: "Cancelada" },
        createdAt: { $gte: months[0].start, $lte: endDate },
      })
        .select("createdAt items")
        .lean(),
    ]);

    const productByName = buildProductByName(products);
    const scopedOrders = scopeOrdersByCategory(orders, productByName, category);
    const availableCategories = collectAvailableCategories(products);
    const monthlyRevenue = calculateMonthlySeries(scopedOrders, months);
    const defaultSnapshot = computeProjectionSnapshot(monthlyRevenue);
    const scenario = parseScenarioFromBody(req.body, defaultSnapshot.whatIf);
    const adjustedSnapshot = computeProjectionSnapshot(monthlyRevenue, scenario);

    return res.json({
      generatedAt: now,
      meta: getFilterMeta(startDate, endDate, category),
      availableCategories,
      ...adjustedSnapshot,
    });
  } catch (error) {
    return handleServerError(
      res,
      error,
      "Error al aplicar modelo de proyecciones",
    );
  }
};
