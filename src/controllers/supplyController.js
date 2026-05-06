const mongoose = require("mongoose");

const { Supply } = require("../models/supply.model");
const SupplyMovement = require("../models/supplyMovement.model");
const { Product } = require("../models/product.model");
const StockMovement = require("../models/stockMovement.model");
const { sendError, handleServerError } = require("../utils/http");
const { notifyLowStock } = require("../utils/stockAlerts");

const normalizeText = (value = "") =>
  value
    .toString()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

const normalizeSku = (value = "") =>
  normalizeText(value)
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toUpperCase();

const generateSkuBase = (name) => {
  const prefix =
    normalizeSku(name).replace(/-/g, "").slice(0, 8).toUpperCase() || "SUP";
  return `SUP-${prefix}`;
};

const generateUniqueSku = async (tenantId, name) => {
  const base = generateSkuBase(name);
  let candidate = base;
  let sequence = 1;

  while (true) {
    const existing = await Product.findOne({
      tenant: tenantId,
      sku: candidate,
    });
    if (!existing) return candidate;
    sequence += 1;
    candidate = `${base}-${String(sequence).padStart(2, "0")}`;
  }
};

/**
 * Map a Product doc (type=raw_material) to the legacy Supply response shape
 * so existing clients are not broken.
 */
function mapProductToSupplyShape(product) {
  const doc = product.toObject ? product.toObject() : product;
  return {
    _id: doc._id,
    sku: doc.sku || undefined,
    name: doc.name,
    unit: doc.unitOfMeasure || "unidad",
    currentStock: doc.stock ?? 0,
    minStock: doc.minStock ?? 0,
    referenceCost: doc.costPrice ?? 0,
    isActive: doc.isActive,
    deletedAt: doc.deletedAt,
    tenant: doc.tenant,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function setDeprecationHeader(res) {
  res.set("Deprecation", "true");
}

/**
 * Get raw_material Products, mapped to Supply shape.
 * Supports ?includeInactive=true to include inactive Products.
 */
exports.getSupplies = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;
    const includeInactive = req.query.includeInactive === "true";
    const filter = includeInactive
      ? { tenant: tenantId, type: "raw_material" }
      : { tenant: tenantId, type: "raw_material", isActive: { $ne: false } };

    const products = await Product.find(filter).sort({ name: 1 });
    const supplies = products.map(mapProductToSupplyShape);

    setDeprecationHeader(res);
    return res.json(supplies);
  } catch (error) {
    return handleServerError(res, error, "Error al obtener insumos");
  }
};

/**
 * Create a Product with type=raw_material (instead of Supply).
 * Accepts legacy Supply field names and maps them.
 * The productController has price required, so we default to 0
 * when no price is provided.
 */
exports.createSupply = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;
    const name = req.body.name?.toString().trim();
    const sku = req.body.sku?.trim() ? normalizeSku(req.body.sku) : null;

    // Check for duplicate by name among raw_material Products
    // Generate unique SKU
    const finalSku = sku || (await generateUniqueSku(tenantId, name));

    const duplicated = await Product.findOne({
      tenant: tenantId,
      type: "raw_material",
      $or: [{ name }, { sku: finalSku }],
    });

    if (duplicated) {
      return sendError(res, {
        status: 409,
        code: "SUPPLY_ALREADY_EXISTS",
        message: "Ya existe un insumo con ese nombre o SKU.",
      });
    }

    // Build payload
    const productPayload = {
      tenant: tenantId,
      name,
      sku: finalSku,
      unitOfMeasure: req.body.unit || "unidad",
      type: "raw_material",
      stock: req.body.currentStock ?? 0,
      minStock: req.body.minStock ?? 0,
      costPrice: req.body.referenceCost ?? 0,
      price: 0,
      isActive: true,
      deletedAt: null,
    };

    const created = await Product.create(productPayload);

    setDeprecationHeader(res);
    return res.status(201).json(mapProductToSupplyShape(created));
  } catch (error) {
    return handleServerError(res, error, "Error al crear insumo");
  }
};

/**
 * Update the corresponding raw_material Product.
 */
exports.updateSupply = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;
    const product = await Product.findOne({
      _id: req.params.id,
      tenant: tenantId,
      type: "raw_material",
      isActive: { $ne: false },
    });

    if (!product) {
      return sendError(res, {
        status: 404,
        code: "SUPPLY_NOT_FOUND",
        message: "Insumo no encontrado",
      });
    }

    const nextName = req.body.name?.toString().trim() || product.name;
    const nextSku = req.body.sku?.trim()
      ? normalizeSku(req.body.sku)
      : product.sku;

    const duplicated = await Product.findOne({
      tenant: tenantId,
      type: "raw_material",
      _id: { $ne: product._id },
      $or: [{ name: nextName }, ...(nextSku ? [{ sku: nextSku }] : [])],
    });

    if (duplicated) {
      return sendError(res, {
        status: 409,
        code: "SUPPLY_ALREADY_EXISTS",
        message: "Ya existe otro insumo con ese nombre o SKU.",
      });
    }

    Object.assign(product, {
      name: nextName,
      sku: nextSku,
      unitOfMeasure: req.body.unit ?? product.unitOfMeasure,
      minStock: req.body.minStock ?? product.minStock,
      costPrice: req.body.referenceCost ?? product.costPrice,
    });

    await product.save();

    setDeprecationHeader(res);
    return res.json(mapProductToSupplyShape(product));
  } catch (error) {
    return handleServerError(res, error, "Error al actualizar insumo");
  }
};

/**
 * Deactivate (soft-delete) the corresponding raw_material Product.
 */
exports.deleteSupply = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;

    const product = await Product.findOneAndUpdate(
      {
        _id: req.params.id,
        tenant: tenantId,
        type: "raw_material",
        isActive: { $ne: false },
      },
      { isActive: false, deletedAt: new Date() },
      { new: true },
    );

    if (!product) {
      return sendError(res, {
        status: 404,
        code: "SUPPLY_NOT_FOUND",
        message: "Insumo no encontrado",
      });
    }

    setDeprecationHeader(res);
    return res.json({ message: "Insumo desactivado", supply: mapProductToSupplyShape(product) });
  } catch (error) {
    return handleServerError(res, error, "Error al desactivar insumo");
  }
};

/**
 * Get StockMovements for the Product (instead of SupplyMovements).
 * Looks up movements by product ID.
 */
exports.getSupplyMovements = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;

    const movements = await StockMovement.find({
      tenant: tenantId,
      product: req.params.id,
    })
      .populate("product", "name sku unitOfMeasure")
      .sort({ createdAt: -1 });

    setDeprecationHeader(res);
    return res.json(movements);
  } catch (error) {
    return handleServerError(res, error, "Error al obtener movimientos de insumo");
  }
};

/**
 * Create a StockMovement for the Product (instead of SupplyMovement).
 */
exports.createSupplyMovement = async (req, res) => {
  const session = await mongoose.startSession();
  let alertProduct = null;

  try {
    await session.withTransaction(async () => {
      const tenantId = req.user?.tenant;
      const { type, quantity, reason, sourceType } = req.body;

      const product = await Product.findOne({
        _id: req.params.id,
        tenant: tenantId,
        type: "raw_material",
        isActive: { $ne: false },
      }).session(session);

      if (!product) {
        throw new Error("SUPPLY_NOT_FOUND");
      }

      const qty = Number(quantity);
      const stockBefore = product.stock;
      let stockAfter = stockBefore;

      if (type === "IN") stockAfter += qty;
      if (type === "OUT") stockAfter -= qty;
      if (type === "ADJUST") stockAfter += qty;

      if (stockAfter < 0) {
        throw new Error("NEGATIVE_STOCK");
      }

      product.stock = stockAfter;
      await product.save({ session });

      // Capture alert data if stock dropped below minimum
      if (stockAfter < stockBefore && product.minStock > 0 && stockAfter <= product.minStock) {
        alertProduct = {
          _id: product._id,
          name: product.name,
          unit: product.unitOfMeasure || "unidad",
          currentStock: stockAfter,
          minStock: product.minStock,
        };
      }

      const movementTypeMap = {
        IN: "ENTRADA",
        OUT: "SALIDA",
        ADJUST: "AJUSTE",
      };

      const movement = await StockMovement.create(
        [
          {
            tenant: tenantId,
            product: product._id,
            type: movementTypeMap[type] || "AJUSTE",
            quantity: qty,
            stockBefore,
            stockAfter,
            reason: reason || "",
            source: "Sistema",
          },
        ],
        { session },
      );

      setDeprecationHeader(res);
      res.status(201).json(movement[0]);
    });
  } catch (error) {
    if (error.message === "SUPPLY_NOT_FOUND") {
      return sendError(res, {
        status: 404,
        code: "SUPPLY_NOT_FOUND",
        message: "Insumo no encontrado",
      });
    }
    if (error.message === "NEGATIVE_STOCK") {
      return sendError(res, {
        status: 409,
        code: "NEGATIVE_STOCK",
        message: "No se permite stock negativo",
      });
    }

    return handleServerError(res, error, "Error al registrar movimiento de insumo");
  } finally {
    await session.endSession();
  }

  // Fire-and-forget: notify after transaction commits
  if (alertProduct && req.user?._id) {
    notifyLowStock(req.user._id, alertProduct).catch(() => {});
  }
};
