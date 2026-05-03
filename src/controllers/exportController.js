const Order = require("../models/order.model");
const { Product } = require("../models/product.model");
const Client = require("../models/client.model");
const Purchase = require("../models/purchase.model");
const { HttpError, handleServerError } = require("../utils/http");

const MS_IN_DAY = 24 * 60 * 60 * 1000;

function parseDateInput(value, mode = "start") {
  if (!value) return null;
  const normalized = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null;
  const date = new Date(`${normalized}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  if (mode === "end") date.setUTCHours(23, 59, 59, 999);
  return date;
}

function escapeCSV(value) {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function sendCSV(res, rows, headers, filename) {
  const headerLine = headers.map((h) => escapeCSV(h.label)).join(",");
  const dataLines = rows.map((row) =>
    headers.map((h) => escapeCSV(row[h.key])).join(","),
  );
  const csv = [headerLine, ...dataLines].join("\n");

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${filename}"`,
  );
  res.send(csv);
}

const normalizeProductName = (value = "") => value.trim().toLowerCase();

function getProductCategory(product) {
  return (
    product?.category || product?.categories?.[0] || "Sin categoria"
  );
}

function collectAvailableCategories(products = []) {
  return Array.from(
    new Set(
      products
        .map((p) => getProductCategory(p))
        .filter(Boolean),
    ),
  ).sort((a, b) => a.localeCompare(b));
}

exports.exportSales = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;
    const now = new Date();
    const defaultStart = new Date(now.getTime() - 365 * MS_IN_DAY);
    const startDate =
      parseDateInput(req.query?.startDate, "start") || defaultStart;
    const endDate = parseDateInput(req.query?.endDate, "end") || now;

    if (startDate > endDate) {
      throw new HttpError(
        400,
        "INVALID_DATE_RANGE",
        "startDate no puede ser mayor a endDate.",
      );
    }

    const orders = await Order.find({
      tenant: tenantId,
      createdAt: { $gte: startDate, $lte: endDate },
    })
      .populate("client", "name phone company")
      .sort({ createdAt: -1 })
      .lean();

    const rows = orders.map((order) => ({
      orderNumber: order.orderNumber || String(order._id).slice(-8),
      date: new Date(order.createdAt).toISOString().slice(0, 10),
      client:
        typeof order.client === "object" && order.client
          ? order.client.name || order.client.phone || ""
          : String(order.client || ""),
      company:
        typeof order.client === "object" && order.client
          ? order.client.company || ""
          : "",
      totalAmount: order.totalAmount || 0,
      salesStatus: order.salesStatus || "",
      paymentStatus: order.paymentStatus || "",
      deliveryStatus: order.deliveryStatus || "",
      itemCount: order.items ? order.items.length : 0,
      source: order.source || "",
    }));

    const headers = [
      { label: "Numero", key: "orderNumber" },
      { label: "Fecha", key: "date" },
      { label: "Cliente", key: "client" },
      { label: "Empresa", key: "company" },
      { label: "Total", key: "totalAmount" },
      { label: "Estado Venta", key: "salesStatus" },
      { label: "Estado Pago", key: "paymentStatus" },
      { label: "Estado Entrega", key: "deliveryStatus" },
      { label: "Cantidad Items", key: "itemCount" },
      { label: "Origen", key: "source" },
    ];

    const safeStart = startDate.toISOString().slice(0, 10).replace(/-/g, "");
    const safeEnd = endDate.toISOString().slice(0, 10).replace(/-/g, "");
    sendCSV(res, rows, headers, `ventas_${safeStart}_${safeEnd}.csv`);
  } catch (error) {
    return handleServerError(res, error, "Error al exportar ventas");
  }
};

exports.exportProductAnalysis = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;
    const now = new Date();
    const defaultStart = new Date(now.getTime() - 28 * MS_IN_DAY);
    const startDate =
      parseDateInput(req.query?.startDate, "start") || defaultStart;
    const endDate = parseDateInput(req.query?.endDate, "end") || now;
    const category = String(req.query?.category || "").trim();

    if (startDate > endDate) {
      throw new HttpError(
        400,
        "INVALID_DATE_RANGE",
        "startDate no puede ser mayor a endDate.",
      );
    }

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

    const productByName = new Map();
    products.forEach((product) => {
      productByName.set(normalizeProductName(product.name), product);
    });

    const productStats = new Map();

    for (const order of orders) {
      for (const item of order.items || []) {
        const product = productByName.get(normalizeProductName(item.product));
        const itemCategory = getProductCategory(product);
        const revenue = (item.quantity || 0) * (item.price || 0);
        const unitCost =
          item.unitCostAtSale !== undefined && item.unitCostAtSale !== null
            ? item.unitCostAtSale
            : product?.costPrice || 0;
        const cogs = (item.quantity || 0) * unitCost;

        if (category && !itemCategory.toLowerCase().includes(category.toLowerCase())) {
          continue;
        }

        const key = normalizeProductName(item.product || "Producto");
        const existing = productStats.get(key) || {
          name: item.product || "Producto",
          category: itemCategory,
          quantity: 0,
          revenue: 0,
          cogs: 0,
        };
        existing.quantity += item.quantity || 0;
        existing.revenue += revenue;
        existing.cogs += cogs;
        productStats.set(key, existing);
      }
    }

    const rows = Array.from(productStats.values()).map((item) => {
      const profit = item.revenue - item.cogs;
      const netMargin =
        item.revenue > 0 ? ((profit / item.revenue) * 100).toFixed(1) : "0.0";
      const roi = item.cogs > 0 ? (profit / item.cogs).toFixed(1) : "0.0";
      const status =
        Number(roi) >= 8 ? "Optimo" : Number(roi) >= 3 ? "Escalando" : "Revisar";
      return {
        name: item.name,
        category: item.category,
        quantity: item.quantity,
        revenue: item.revenue.toFixed(2),
        cogs: item.cogs.toFixed(2),
        netMargin: `${netMargin}%`,
        roi: `${roi}x`,
        status,
      };
    });

    const headers = [
      { label: "Producto", key: "name" },
      { label: "Categoria", key: "category" },
      { label: "Cantidad Vendida", key: "quantity" },
      { label: "Ingresos", key: "revenue" },
      { label: "Costo Mercaderia", key: "cogs" },
      { label: "Margen Neto", key: "netMargin" },
      { label: "ROI", key: "roi" },
      { label: "Estado", key: "status" },
    ];

    const safeStart = startDate.toISOString().slice(0, 10).replace(/-/g, "");
    const safeEnd = endDate.toISOString().slice(0, 10).replace(/-/g, "");
    sendCSV(res, rows, headers, `analisis_productos_${safeStart}_${safeEnd}.csv`);
  } catch (error) {
    return handleServerError(res, error, "Error al exportar analisis de productos");
  }
};

exports.exportAccounting = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;
    const now = new Date();
    const yearStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
    const startDate =
      parseDateInput(req.query?.startDate, "start") || yearStart;
    const endDate = parseDateInput(req.query?.endDate, "end") || now;
    const category = String(req.query?.category || "").trim();

    if (startDate > endDate) {
      throw new HttpError(
        400,
        "INVALID_DATE_RANGE",
        "startDate no puede ser mayor a endDate.",
      );
    }

    const [products, clients, orders] = await Promise.all([
      Product.find({ tenant: tenantId })
        .select("name category categories costPrice stock")
        .lean(),
      Client.find({ tenant: tenantId, isActive: { $ne: false } })
        .select("debt")
        .lean(),
      Order.find({
        tenant: tenantId,
        createdAt: { $gte: startDate, $lte: endDate },
      })
        .populate("client", "name phone")
        .sort({ createdAt: -1 })
        .lean(),
    ]);

    const productByName = new Map();
    products.forEach((p) =>
      productByName.set(normalizeProductName(p.name), p),
    );

    const scopedOrders = [];
    for (const order of orders) {
      const scopedItems = (order.items || []).filter((item) => {
        const product = productByName.get(normalizeProductName(item.product));
        const itemCategory = getProductCategory(product);
        if (
          category &&
          !itemCategory.toLowerCase().includes(category.toLowerCase())
        )
          return false;
        return true;
      });

      if (scopedItems.length === 0 && order.items && order.items.length > 0 && category) {
        continue;
      }

      const scopedRevenue = scopedItems.reduce(
        (sum, item) => sum + (item.quantity || 0) * (item.price || 0),
        0,
      );

      scopedOrders.push({
        ...order,
        scopedItems,
        scopedRevenue,
        scopedCogs: scopedItems.reduce((sum, item) => {
          const product = productByName.get(normalizeProductName(item.product));
          const unitCost =
            item.unitCostAtSale !== undefined && item.unitCostAtSale !== null
              ? item.unitCostAtSale
              : product?.costPrice || 0;
          return sum + (item.quantity || 0) * unitCost;
        }, 0),
      });
    }

    const rows = scopedOrders.map((order) => ({
      date: new Date(order.createdAt).toISOString().slice(0, 10),
      description:
        (order.scopedItems && order.scopedItems[0]?.product) ||
        order.orderNumber ||
        "Operacion",
      category: order.source === "WhatsApp" ? "Ventas" : "Operativo",
      refId: order.orderNumber || String(order._id).slice(-6),
      revenue: order.scopedRevenue.toFixed(2),
      cogs: order.scopedCogs.toFixed(2),
      paymentStatus: order.paymentStatus || "",
      salesStatus: order.salesStatus || "",
    }));

    const headers = [
      { label: "Fecha", key: "date" },
      { label: "Descripcion", key: "description" },
      { label: "Categoria", key: "category" },
      { label: "Referencia", key: "refId" },
      { label: "Ingresos", key: "revenue" },
      { label: "Costo Mercaderia", key: "cogs" },
      { label: "Estado Pago", key: "paymentStatus" },
      { label: "Estado Venta", key: "salesStatus" },
    ];

    const safeStart = startDate.toISOString().slice(0, 10).replace(/-/g, "");
    const safeEnd = endDate.toISOString().slice(0, 10).replace(/-/g, "");
    sendCSV(res, rows, headers, `contabilidad_${safeStart}_${safeEnd}.csv`);
  } catch (error) {
    return handleServerError(res, error, "Error al exportar contabilidad");
  }
};

exports.exportClients = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;

    const clients = await Client.find({
      tenant: tenantId,
      isActive: { $ne: false },
    })
      .sort({ name: 1 })
      .lean();

    const rows = clients.map((client) => ({
      name: client.name || "",
      company: client.company || "",
      phone: client.phone || "",
      email: client.email || "",
      taxId: client.taxId || "",
      address: client.address || "",
      fiscalAddress: client.fiscalAddress || "",
      debt: (client.debt || 0).toFixed(2),
      notes: client.notes || "",
    }));

    const headers = [
      { label: "Nombre", key: "name" },
      { label: "Empresa", key: "company" },
      { label: "Telefono", key: "phone" },
      { label: "Email", key: "email" },
      { label: "Documento Fiscal", key: "taxId" },
      { label: "Direccion", key: "address" },
      { label: "Direccion Fiscal", key: "fiscalAddress" },
      { label: "Deuda", key: "debt" },
      { label: "Notas", key: "notes" },
    ];

    sendCSV(res, rows, headers, `clientes_${new Date().toISOString().slice(0, 10).replace(/-/g, "")}.csv`);
  } catch (error) {
    return handleServerError(res, error, "Error al exportar clientes");
  }
};

exports.exportPurchases = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;
    const now = new Date();
    const defaultStart = new Date(now.getTime() - 365 * MS_IN_DAY);
    const startDate =
      parseDateInput(req.query?.startDate, "start") || defaultStart;
    const endDate = parseDateInput(req.query?.endDate, "end") || now;

    if (startDate > endDate) {
      throw new HttpError(
        400,
        "INVALID_DATE_RANGE",
        "startDate no puede ser mayor a endDate.",
      );
    }

    const purchases = await Purchase.find({
      tenant: tenantId,
      date: { $gte: startDate, $lte: endDate },
    })
      .populate("supplier", "name company")
      .sort({ date: -1 })
      .lean();

    const rows = purchases.map((purchase) => ({
      date: new Date(purchase.date).toISOString().slice(0, 10),
      supplier:
        typeof purchase.supplier === "object" && purchase.supplier
          ? purchase.supplier.name || purchase.supplier.company || ""
          : "",
      status: purchase.status || "",
      paymentCondition: purchase.paymentCondition || "",
      subtotal: (purchase.subtotal || 0).toFixed(2),
      tax: (purchase.tax || 0).toFixed(2),
      total: (purchase.total || 0).toFixed(2),
      itemCount: purchase.items ? purchase.items.length : 0,
      notes: purchase.notes || "",
    }));

    const headers = [
      { label: "Fecha", key: "date" },
      { label: "Proveedor", key: "supplier" },
      { label: "Estado", key: "status" },
      { label: "Condicion Pago", key: "paymentCondition" },
      { label: "Subtotal", key: "subtotal" },
      { label: "Impuestos", key: "tax" },
      { label: "Total", key: "total" },
      { label: "Cantidad Items", key: "itemCount" },
      { label: "Notas", key: "notes" },
    ];

    const safeStart = startDate.toISOString().slice(0, 10).replace(/-/g, "");
    const safeEnd = endDate.toISOString().slice(0, 10).replace(/-/g, "");
    sendCSV(res, rows, headers, `compras_${safeStart}_${safeEnd}.csv`);
  } catch (error) {
    return handleServerError(res, error, "Error al exportar compras");
  }
};