const mongoose = require("mongoose");
const Order = require("../models/order.model");
const { Product } = require("../models/product.model");

// Windows are measured in days back from now. "prev30" is derived as sold60 - sold30.
const DAYS_LONG = 90;
const IDLE_DAYS = 60;
const LOW_COVER_DAYS = 10;
const MIN_UNITS_FOR_ANALYSIS = 5;
const TOP_N = 5;

const round = (value, digits = 1) => {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

// Pure: receives already-bucketed sales per product and returns the facts the advisor may cite.
const buildRotationFacts = ({ products = [], salesByProduct = new Map() }) => {
  const rows = products.map((product) => {
    const id = String(product._id);
    const sales = salesByProduct.get(id) || { sold30: 0, sold60: 0, sold90: 0, revenue90: 0, cost90: 0 };
    const stock = Number(product.stock || 0);
    const costPrice = Number(product.costPrice || 0);
    const prev30 = Math.max(sales.sold60 - sales.sold30, 0);
    const dailyRate = sales.sold90 / DAYS_LONG;

    return {
      id,
      name: product.name,
      unit: product.unitOfMeasure || "unidad",
      category: product.category || "",
      stock,
      sold30: sales.sold30,
      sold90: sales.sold90,
      // Current stock stands in for average stock: there is no stock history per product yet.
      rotation90: stock > 0 ? round(sales.sold90 / stock, 2) : null,
      coverDays: dailyRate > 0 && stock > 0 ? round(stock / dailyRate, 0) : null,
      trendPct: prev30 > 0 ? round(((sales.sold30 - prev30) / prev30) * 100, 0) : null,
      marginPct:
        sales.revenue90 > 0 && sales.cost90 > 0
          ? round(((sales.revenue90 - sales.cost90) / sales.revenue90) * 100, 0)
          : null,
      idle: stock > 0 && sales.sold60 === 0,
      capitalTied: stock > 0 && costPrice > 0 ? round(stock * costPrice, 0) : 0,
    };
  });

  const totalSold90 = rows.reduce((sum, row) => sum + row.sold90, 0);
  const idle = rows.filter((row) => row.idle).sort((a, b) => b.capitalTied - a.capitalTied);
  const sellers = rows.filter((row) => row.sold90 > 0);

  return {
    windowDays: DAYS_LONG,
    idleAfterDays: IDLE_DAYS,
    enoughData: totalSold90 >= MIN_UNITS_FOR_ANALYSIS,
    totals: {
      productsAnalyzed: rows.length,
      unitsSold90: totalSold90,
      idleCount: idle.length,
      idleCapitalTied: round(idle.reduce((sum, row) => sum + row.capitalTied, 0), 0),
    },
    fastestMovers: [...sellers].sort((a, b) => b.sold90 - a.sold90).slice(0, TOP_N),
    lowCover: sellers
      .filter((row) => row.coverDays !== null && row.coverDays < LOW_COVER_DAYS)
      .sort((a, b) => a.coverDays - b.coverDays)
      .slice(0, TOP_N),
    idleStock: idle.slice(0, TOP_N),
    risingSales: sellers
      .filter((row) => row.trendPct !== null && row.trendPct > 0)
      .sort((a, b) => b.trendPct - a.trendPct)
      .slice(0, TOP_N),
    fallingSales: sellers
      .filter((row) => row.trendPct !== null && row.trendPct < 0)
      .sort((a, b) => a.trendPct - b.trendPct)
      .slice(0, TOP_N),
    note:
      "Rotación y cobertura usan el stock actual como aproximación del stock promedio. Las tendencias comparan los últimos 30 días con los 30 anteriores.",
  };
};

// Loads the tenant's sales and products and returns the facts. Only reads; never writes.
const loadRotationFacts = async (tenantId, now = new Date()) => {
  const tenantObjectId = new mongoose.Types.ObjectId(String(tenantId));
  const daysAgo = (days) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  const [salesRows, products] = await Promise.all([
    Order.aggregate([
      {
        $match: {
          tenant: tenantObjectId,
          createdAt: { $gte: daysAgo(DAYS_LONG) },
          salesStatus: { $ne: "Cancelada" },
        },
      },
      { $unwind: "$items" },
      { $match: { "items.productId": { $ne: null } } },
      {
        $group: {
          _id: "$items.productId",
          sold30: {
            $sum: { $cond: [{ $gte: ["$createdAt", daysAgo(30)] }, "$items.quantity", 0] },
          },
          sold60: {
            $sum: { $cond: [{ $gte: ["$createdAt", daysAgo(IDLE_DAYS)] }, "$items.quantity", 0] },
          },
          sold90: { $sum: "$items.quantity" },
          revenue90: { $sum: { $multiply: ["$items.price", "$items.quantity"] } },
          cost90: { $sum: { $multiply: ["$items.unitCostAtSale", "$items.quantity"] } },
        },
      },
    ]),
    Product.find({ tenant: tenantObjectId, isActive: { $ne: false } })
      .select("name stock costPrice unitOfMeasure category")
      .lean(),
  ]);

  const salesByProduct = new Map(
    salesRows.map((row) => [
      String(row._id),
      {
        sold30: row.sold30,
        sold60: row.sold60,
        sold90: row.sold90,
        revenue90: row.revenue90,
        cost90: row.cost90,
      },
    ]),
  );

  return buildRotationFacts({ products, salesByProduct });
};

// Parses numbers the way es-AR writes them: "1.234,5" -> 1234.5, "12,5" -> 12.5, "1.234" -> 1234.
const parseLocaleNumber = (raw) => {
  const cleaned = raw.replace(/\$/g, "").trim();
  const normalized = /^\d{1,3}(\.\d{3})+(,\d+)?$/.test(cleaned)
    ? cleaned.replace(/\./g, "").replace(",", ".")
    : cleaned.replace(",", ".");
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
};

// Calendar windows and thresholds the prompt itself mentions; they are not data.
const ALLOWED_CONSTANTS = [30, 60, 90, LOW_COVER_DAYS];

// Returns numbers in the reply that do not appear in the facts. Empty array = every number is grounded.
const findUnsupportedNumbers = (reply, facts) => {
  const factNumbers = new Set();
  // Ids are hex strings; their digit runs are not business numbers, so they are left out.
  const factsWithoutIds = JSON.stringify(facts, (key, value) => (key === "id" ? undefined : value));
  factsWithoutIds.replace(/-?\d+(\.\d+)?/g, (match) => {
    const value = Number(match);
    factNumbers.add(round(Math.abs(value), 1));
    return match;
  });
  ALLOWED_CONSTANTS.forEach((value) => factNumbers.add(value));

  const replyNumbers = (reply.match(/\d{1,3}(\.\d{3})+(,\d+)?|\d+(,\d+)?/g) || [])
    .map(parseLocaleNumber)
    .filter((value) => value !== null);

  return replyNumbers.filter((value) => !factNumbers.has(round(value, 1)));
};

const formatMoneyFact = (value) => `$${Math.round(value).toLocaleString("es-AR")}`;

// Deterministic summary used when the model's reply cannot be trusted.
const renderFallbackSummary = (facts) => {
  if (!facts.enoughData) {
    return "Todavía hay pocas ventas en los últimos 90 días para analizar la rotación. Volvé a preguntar cuando haya más movimiento.";
  }

  const lines = ["📦 *Análisis de rotación (datos calculados)*"];
  const [top] = facts.fastestMovers;
  if (top) lines.push(`🔹 Más vendido: ${top.name}, ${top.sold90} ${top.unit} en 90 días.`);

  const [low] = facts.lowCover;
  if (low) lines.push(`⚠️ Cobertura corta: ${low.name}, ~${low.coverDays} días de stock.`);

  if (facts.totals.idleCount > 0) {
    lines.push(
      `🧊 Sin ventas hace ${IDLE_DAYS} días: ${facts.totals.idleCount} productos, con ~${formatMoneyFact(facts.totals.idleCapitalTied)} de capital inmovilizado.`,
    );
  }

  const [rising] = facts.risingSales;
  if (rising) lines.push(`📈 Subiendo: ${rising.name} (${rising.trendPct}% vs 30 días previos).`);

  const [falling] = facts.fallingSales;
  if (falling) lines.push(`📉 Bajando: ${falling.name} (${falling.trendPct}% vs 30 días previos).`);

  return lines.join("\n");
};

const buildAdvisorSystemPrompt = () => `
Eres el asesor de inventario de un comercio. Recibes un JSON con hechos ya calculados.
Reglas estrictas:
- Usa solo los números que aparecen en el JSON. Nunca hagas cuentas ni estimes cifras nuevas.
- Separa cada afirmación en DATO (sale del JSON) o HIPÓTESIS (una suposición, con el dato que la confirmaría).
- Si el JSON dice enoughData=false, dilo y no recomiendes compras.
- Propón acciones concretas (reponer, dejar de reponer, liquidar, revisar precio), sin ejecutar nada.
- Máximo 8 líneas, en español rioplatense cordial, con viñetas cortas.
`;

const buildAdvisorUserPrompt = (facts, question) =>
  `Pregunta: ${question}\nHechos:\n${JSON.stringify(facts)}`;

module.exports = {
  buildRotationFacts,
  loadRotationFacts,
  findUnsupportedNumbers,
  parseLocaleNumber,
  renderFallbackSummary,
  buildAdvisorSystemPrompt,
  buildAdvisorUserPrompt,
};
