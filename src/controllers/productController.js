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

const normalizePresentations = (presentations) => {
  if (!Array.isArray(presentations)) return [];
  return presentations
    .map((p) => ({
      ...(p._id ? { _id: p._id } : {}),
      sku: p.sku ? normalizeSku(p.sku) : undefined,
      barcode: p.barcode?.toString().trim().toUpperCase() || undefined,
      name: p.name?.toString().trim(),
      unitOfMeasure: UNIT_OPTIONS.includes(p.unitOfMeasure)
        ? p.unitOfMeasure
        : "unidad",
      price: p.price,
      equivalentQty: p.equivalentQty,
      isActive: p.isActive !== false,
    }))
    .filter((p) => p.name);
};

const validatePresentationCollisions = async (
  tenantId,
  presentations,
  currentProductId = null,
) => {
  const skus = [];
  const barcodes = [];

  for (const p of presentations || []) {
    if (p.sku) skus.push(p.sku);
    if (p.barcode) barcodes.push(p.barcode);
  }

  if (skus.length === 0 && barcodes.length === 0) return null;

  const duplicateSku = skus.find((s, i) => skus.indexOf(s) !== i);
  if (duplicateSku) {
    return { message: "Ya existe un producto con ese SKU" };
  }

  const duplicateBarcode = barcodes.find((b, i) => barcodes.indexOf(b) !== i);
  if (duplicateBarcode) {
    return { message: "Ya existe un producto con ese código de barras" };
  }

  const orConditions = [];
  if (skus.length) {
    orConditions.push({ sku: { $in: skus } });
    orConditions.push({ "presentations.sku": { $in: skus } });
  }
  if (barcodes.length) {
    orConditions.push({ barcode: { $in: barcodes } });
    orConditions.push({ "presentations.barcode": { $in: barcodes } });
  }

  const existing = await Product.findOne({
    tenant: tenantId,
    ...(currentProductId ? { _id: { $ne: currentProductId } } : {}),
    $or: orConditions,
  });

  if (existing) {
    const skuMatch = skus.find(
      (s) =>
        s === existing.sku ||
        existing.presentations?.some((pres) => pres.sku === s),
    );
    const barcodeMatch = barcodes.find(
      (b) =>
        b === existing.barcode ||
        existing.presentations?.some((pres) => pres.barcode === b),
    );
    const field =
      skuMatch && barcodeMatch
        ? "SKU y código de barras"
        : skuMatch
          ? "SKU"
          : "código de barras";
    return { message: `Ya existe un producto con ese ${field}` };
  }

  return null;
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

  const result = {
    tenant: tenantId,
    name,
    description: payload.description?.toString().trim() || undefined,
    price: payload.price,
    costPrice: payload.costPrice,
    stock: payload.stock || 0,
    minStock: payload.minStock || 0,
    category: categories[0] || undefined,
    categories,
    unitOfMeasure: normalizedUnit,
    type: payload.type || undefined,
    purchaseUnit: payload.purchaseUnit || undefined,
    purchaseEquivalentQty: payload.purchaseEquivalentQty || undefined,
    costLocked: payload.costLocked || undefined,
    presentations: normalizePresentations(payload.presentations),
    isActive: true,
    deletedAt: null,
  };

  // Only include sku if truthy (avoid sparse unique index issues with null)
  if (sku) result.sku = sku;

  // Only include barcode if provided and truthy
  const barcode = payload.barcode?.toString().trim();
  if (barcode) {
    result.barcode = barcode;
  }

  // Clean up undefined keys to avoid Mongoose setting null on sparse indexed fields
  for (const key of Object.keys(result)) {
    if (result[key] === undefined) {
      delete result[key];
    }
  }

  return result;
};

// Buscar productos por código de barras, SKU o nombre
exports.lookupProductByCode = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;
    const { code } = req.params;
    const normalizedCode = code.toString().trim().toUpperCase();
    const MAX_RESULTS = 10;

    const activeFilter = { tenant: tenantId, isActive: { $ne: false } };

    // 1. Barcode exacto (prioridad máxima)
    const barcodeExact = await Product.find({
      ...activeFilter,
      barcode: normalizedCode,
    }).limit(MAX_RESULTS);

    // 2. SKU exacto
    const skuExact = await Product.find({
      ...activeFilter,
      sku: normalizedCode,
    }).limit(MAX_RESULTS);

    // 3. Barcode exacto en presentaciones
    const barcodeExactPresentations = await Product.find({
      ...activeFilter,
      "presentations.barcode": normalizedCode,
    }).limit(MAX_RESULTS);

    // 4. SKU exacto en presentaciones
    const skuExactPresentations = await Product.find({
      ...activeFilter,
      "presentations.sku": normalizedCode,
    }).limit(MAX_RESULTS);

    // 5. Búsqueda general: barcode, SKU o nombre que contenga el texto
    const general = await Product.find({
      ...activeFilter,
      $or: [
        { barcode: { $regex: normalizedCode, $options: "i" } },
        { sku: { $regex: normalizedCode, $options: "i" } },
        { name: { $regex: normalizedCode, $options: "i" } },
        { "presentations.sku": { $regex: normalizedCode, $options: "i" } },
        { "presentations.barcode": { $regex: normalizedCode, $options: "i" } },
      ],
    }).limit(MAX_RESULTS);

    // Combinar resultados sin duplicados, priorizando exactos
    const productMap = new Map();

    const addToMap = (arr, getMatch = null) => {
      for (const p of arr) {
        const id = p._id.toString();
        if (!productMap.has(id)) {
          const plain = p.toObject();
          if (getMatch) {
            const match = getMatch(p);
            if (match) plain.matchedPresentation = match.toObject();
          }
          productMap.set(id, plain);
        }
      }
    };

    addToMap(barcodeExact);
    addToMap(skuExact);
    addToMap(barcodeExactPresentations, (p) =>
      p.presentations.find((pres) => pres.barcode === normalizedCode),
    );
    addToMap(skuExactPresentations, (p) =>
      p.presentations.find((pres) => pres.sku === normalizedCode),
    );
    addToMap(general);

    const products = Array.from(productMap.values());

    if (products.length === 0) {
      return sendError(res, {
        status: 404,
        code: "PRODUCT_NOT_FOUND",
        message: "No se encontraron productos",
      });
    }

    res.json({ products });
  } catch (error) {
    return handleServerError(res, error, "Error al buscar producto");
  }
};

// Obtener todos los productos
exports.getProducts = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;
    const includeInactive = req.query.includeInactive === "true";
    const filter = includeInactive
      ? { tenant: tenantId }
      : { tenant: tenantId, isActive: { $ne: false } };
    // Support filtering by type (e.g. ?type=raw_material)
    if (req.query.type) {
      filter.type = req.query.type;
    }

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

    const normalizedBarcode = req.body.barcode?.toString().trim().toUpperCase();

    const existingProduct = await Product.findOne({
      tenant: tenantId,
      $or: [
        { name: normalizedName },
        ...(normalizedSku ? [{ sku: normalizedSku }] : []),
        ...(normalizedBarcode ? [{ barcode: normalizedBarcode }] : []),
      ],
    });
    if (existingProduct) {
      const reason =
        existingProduct.name === normalizedName
          ? "nombre"
          : existingProduct.sku === normalizedSku
            ? "SKU"
            : "código de barras";
      return sendError(res, {
        status: 409,
        code: "PRODUCT_ALREADY_EXISTS",
        message: `Ya existe un producto con ese ${reason}`,
      });
    }

    const payload = await buildProductPayload(
      tenantId,
      { ...req.body, name: normalizedName, sku: normalizedSku, categories: normalizedCategories },
      null,
    );

    // raw_material products: price defaults to 0 if not provided
    if (payload.type === "raw_material" && payload.price === undefined) {
      payload.price = 0;
    }

    const collision = await validatePresentationCollisions(tenantId, payload.presentations);
    if (collision) {
      return sendError(res, {
        status: 409,
        code: "PRODUCT_ALREADY_EXISTS",
        message: collision.message,
      });
    }

    const newProduct = new Product(payload);
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

    // Rechazar cambio de costPrice si el producto tiene costLocked
    if (
      existingProduct.costLocked &&
      req.body.costPrice !== undefined &&
      req.body.costPrice !== existingProduct.costPrice
    ) {
      return sendError(res, {
        status: 409,
        code: "COST_LOCKED",
        message:
          "No se puede modificar el costo de un producto que ya tiene compras registradas.",
      });
    }

    const nextName = req.body.name?.toString().trim() || existingProduct.name;
    const nextSku = req.body.sku?.trim()
      ? normalizeSku(req.body.sku)
      : existingProduct.sku;

    const nextBarcode = req.body.barcode?.toString().trim().toUpperCase();

    const duplicated = await Product.findOne({
      tenant: tenantId,
      _id: { $ne: req.params.id },
      $or: [
        { name: nextName },
        ...(nextSku ? [{ sku: nextSku }] : []),
        ...(nextBarcode ? [{ barcode: nextBarcode }] : []),
      ],
    });

    if (duplicated) {
      const reason =
        duplicated.name === nextName
          ? "nombre"
          : duplicated.sku === nextSku
            ? "SKU"
            : "código de barras";
      return sendError(res, {
        status: 409,
        code: "PRODUCT_ALREADY_EXISTS",
        message: `Ya existe un producto con ese ${reason}`,
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

    const collision = await validatePresentationCollisions(
      tenantId,
      payload.presentations,
      req.params.id,
    );
    if (collision) {
      return sendError(res, {
        status: 409,
        code: "PRODUCT_ALREADY_EXISTS",
        message: collision.message,
      });
    }

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
