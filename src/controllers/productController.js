const { Product, UNIT_OPTIONS } = require("../models/product.model");
const {
  createAndDispatchNotification,
} = require("../services/notificationService");
const { sendError, handleServerError } = require("../utils/http");

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

const normalizeCategories = (categories, category) => {
  const source = Array.isArray(categories)
    ? categories
    : category
      ? [category]
      : [];

  return Array.from(
    new Set(
      source
        .map((item) => item?.toString().trim())
        .filter(Boolean),
    ),
  );
};

const generateSkuBase = (name, categories) => {
  const categoryPrefix = normalizeSku(categories[0] || "GEN").slice(0, 3) || "GEN";
  const namePrefix =
    normalizeSku(name).replace(/-/g, "").slice(0, 5) || "ITEM";

  return `${categoryPrefix}-${namePrefix}`;
};

const generateUniqueSku = async (
  tenantId,
  name,
  categories,
  currentProductId = null,
) => {
  const base = generateSkuBase(name, categories);
  let candidate = base;
  let sequence = 1;

  while (true) {
    const existing = await Product.findOne({
      tenant: tenantId,
      sku: candidate,
      ...(currentProductId ? { _id: { $ne: currentProductId } } : {}),
    });

    if (!existing) return candidate;

    sequence += 1;
    candidate = `${base}-${String(sequence).padStart(2, "0")}`;
  }
};

const buildProductPayload = async (tenantId, payload, currentProductId = null) => {
  const categories = normalizeCategories(payload.categories, payload.category);
  const name = payload.name?.toString().trim();
  const normalizedUnit = UNIT_OPTIONS.includes(payload.unitOfMeasure)
    ? payload.unitOfMeasure
    : "unidad";

  const sku = payload.sku?.trim()
    ? normalizeSku(payload.sku)
    : await generateUniqueSku(tenantId, name, categories, currentProductId);

  return {
    tenant: tenantId,
    sku,
    name,
    description: payload.description?.toString().trim() || undefined,
    price: payload.price,
    costPrice: payload.costPrice,
    stock: payload.stock || 0,
    minStock: payload.minStock || 0,
    category: categories[0] || undefined,
    categories,
    unitOfMeasure: normalizedUnit,
    isActive: true,
    deletedAt: null,
  };
};

// Obtener todos los productos
exports.getProducts = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;
    const includeInactive = req.query.includeInactive === "true";
    const filter = includeInactive
      ? { tenant: tenantId }
      : { tenant: tenantId, isActive: { $ne: false } };
    const hasPagination =
      req.query.page !== undefined || req.query.limit !== undefined;

    if (!hasPagination) {
      const products = await Product.find(filter).sort({ name: 1 });
      return res.json(products);
    }

    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    const skip = (page - 1) * limit;

    const [products, total] = await Promise.all([
      Product.find(filter).sort({ name: 1 }).skip(skip).limit(limit),
      Product.countDocuments(filter),
    ]);

    const totalPages = Math.ceil(total / limit) || 1;

    return res.json({
      products,
      totalPages,
      currentPage: page,
      total,
      hasNextPage: page < totalPages,
    });
  } catch (error) {
    return handleServerError(res, error, "Error al obtener productos");
  }
};

// Obtener un producto por ID
exports.getProductById = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;
    const includeInactive = req.query.includeInactive === "true";
    const filter = includeInactive
      ? { tenant: tenantId }
      : { tenant: tenantId, isActive: { $ne: false } };
    const product = await Product.findOne({ _id: req.params.id, ...filter });
    if (!product) {
      return sendError(res, {
        status: 404,
        code: "PRODUCT_NOT_FOUND",
        message: "Producto no encontrado",
      });
    }
    res.json({ product });
  } catch (error) {
    return handleServerError(res, error, "Error al obtener el producto");
  }
};

// Crear un nuevo producto
exports.createProduct = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;
    const {
      sku,
      name,
      categories,
      category,
    } = req.body;

    const normalizedName = name?.toString().trim();
    const normalizedSku = sku?.trim() ? normalizeSku(sku) : null;
    const normalizedCategories = normalizeCategories(categories, category);

    const existingProduct = await Product.findOne({
      tenant: tenantId,
      $or: [
        { name: normalizedName },
        ...(normalizedSku ? [{ sku: normalizedSku }] : []),
      ],
    });
    if (existingProduct) {
      return sendError(res, {
        status: 409,
        code: "PRODUCT_ALREADY_EXISTS",
        message: "Ya existe un producto con este nombre o SKU",
      });
    }

    const newProduct = new Product(
      await buildProductPayload(
        tenantId,
        { ...req.body, name: normalizedName, sku: normalizedSku, categories: normalizedCategories },
        null,
      ),
    );
    await newProduct.save();
    await createAndDispatchNotification({
      userId: req.user?._id,
      type: "success",
      title: "Producto creado",
      message: `Se agregó ${newProduct.name} al catálogo.`,
      metadata: { productId: newProduct._id },
    });
    res.status(201).json(newProduct);
  } catch (error) {
    return handleServerError(res, error, "Error al crear el producto");
  }
};

// Actualizar un producto
exports.updateProduct = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;
    const existingProduct = await Product.findOne({
      tenant: tenantId,
      _id: req.params.id,
      isActive: { $ne: false },
    });

    if (!existingProduct) {
      return sendError(res, {
        status: 404,
        code: "PRODUCT_NOT_FOUND",
        message: "Producto no encontrado",
      });
    }

    const nextName = req.body.name?.toString().trim() || existingProduct.name;
    const nextSku = req.body.sku?.trim()
      ? normalizeSku(req.body.sku)
      : existingProduct.sku;

    const duplicated = await Product.findOne({
      tenant: tenantId,
      _id: { $ne: req.params.id },
      $or: [{ name: nextName }, ...(nextSku ? [{ sku: nextSku }] : [])],
    });

    if (duplicated) {
      return sendError(res, {
        status: 409,
        code: "PRODUCT_ALREADY_EXISTS",
        message: "Ya existe un producto con este nombre o SKU",
      });
    }

    const payload = await buildProductPayload(
      tenantId,
      {
        ...existingProduct.toObject(),
        ...req.body,
        name: nextName,
        sku: nextSku,
        categories: normalizeCategories(
          req.body.categories ?? existingProduct.categories,
          req.body.category ?? existingProduct.category,
        ),
      },
      req.params.id,
    );

    const updatedProduct = await Product.findOneAndUpdate(
      { _id: req.params.id, tenant: tenantId, isActive: { $ne: false } },
      payload,
      { returnDocument: "after" },
    );
    if (!updatedProduct) {
      return sendError(res, {
        status: 404,
        code: "PRODUCT_NOT_FOUND",
        message: "Producto no encontrado",
      });
    }
    await createAndDispatchNotification({
      userId: req.user?._id,
      type: "info",
      title: "Producto actualizado",
      message: `Se actualizó ${updatedProduct.name}.`,
      metadata: { productId: updatedProduct._id },
    });
    res.json(updatedProduct);
  } catch (error) {
    return handleServerError(res, error, "Error al actualizar el producto");
  }
};

// Eliminar un producto
exports.deleteProduct = async (req, res) => {
  try {
    const product = await Product.findOneAndUpdate(
      { _id: req.params.id, tenant: req.user?.tenant, isActive: { $ne: false } },
      { isActive: false, deletedAt: new Date() },
      { returnDocument: "after" },
    );
    if (!product) {
      return sendError(res, {
        status: 404,
        code: "PRODUCT_NOT_FOUND",
        message: "Producto no encontrado",
      });
    }
    await createAndDispatchNotification({
      userId: req.user?._id,
      type: "warning",
      title: "Producto desactivado",
      message: `Se desactivó ${product.name}.`,
      metadata: { productId: product._id },
    });
    res.json({ message: "Producto desactivado correctamente" });
  } catch (error) {
    return handleServerError(res, error, "Error al desactivar el producto");
  }
};
