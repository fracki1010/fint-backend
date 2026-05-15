const mongoose = require("mongoose");

const BillOfMaterial = require("../models/billOfMaterial.model");
const ProductionLog = require("../models/productionLog.model");
const { Product } = require("../models/product.model");
const StockMovement = require("../models/stockMovement.model");
const { sendError, handleServerError } = require("../utils/http");
const { notifyLowStock } = require("../utils/stockAlerts");

const POPULATE_BOM = [
  { path: "product", select: "name sku unitOfMeasure presentations" },
  { path: "ingredients.product", select: "name sku unitOfMeasure stock costPrice minStock presentations" },
];

exports.getBillOfMaterials = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;
    const includeInactive = req.query.includeInactive === "true";
    const filter = includeInactive
      ? { tenant: tenantId }
      : { tenant: tenantId, isActive: { $ne: false } };

    const boms = await BillOfMaterial.find(filter)
      .populate(POPULATE_BOM)
      .sort({ name: 1 });

    return res.json(boms);
  } catch (error) {
    return handleServerError(res, error, "Error al obtener listas de materiales");
  }
};

exports.getBillOfMaterialById = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;
    const bom = await BillOfMaterial.findOne({
      _id: req.params.id,
      tenant: tenantId,
      isActive: { $ne: false },
    }).populate(POPULATE_BOM);

    if (!bom) {
      return sendError(res, {
        status: 404,
        code: "BOM_NOT_FOUND",
        message: "Lista de materiales no encontrada",
      });
    }

    return res.json(bom);
  } catch (error) {
    return handleServerError(res, error, "Error al obtener lista de materiales");
  }
};

exports.createBillOfMaterial = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;
    const name = req.body.name?.toString().trim();

    if (!name) {
      return sendError(res, {
        status: 400,
        code: "VALIDATION_ERROR",
        message: "El nombre es requerido.",
      });
    }

    const duplicated = await BillOfMaterial.findOne({ tenant: tenantId, name });
    if (duplicated) {
      return sendError(res, {
        status: 409,
        code: "BOM_ALREADY_EXISTS",
        message: "Ya existe una lista de materiales con ese nombre.",
      });
    }

    const ingredients = (req.body.ingredients || []).map((ing) => ({
      product: ing.product || ing.productItemId || null,
      presentationId: ing.presentationId || null,
      quantity: ing.quantity,
    }));

    const created = await BillOfMaterial.create({
      tenant: tenantId,
      name,
      product: req.body.productId || null,
      presentationId: req.body.presentationId || null,
      yieldQuantity: req.body.yieldQuantity || 1,
      ingredients,
      notes: req.body.notes || "",
      isActive: true,
      deletedAt: null,
    });

    await created.populate(POPULATE_BOM);

    return res.status(201).json(created);
  } catch (error) {
    return handleServerError(res, error, "Error al crear lista de materiales");
  }
};

exports.updateBillOfMaterial = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;
    const bom = await BillOfMaterial.findOne({
      _id: req.params.id,
      tenant: tenantId,
      isActive: { $ne: false },
    });

    if (!bom) {
      return sendError(res, {
        status: 404,
        code: "BOM_NOT_FOUND",
        message: "Lista de materiales no encontrada",
      });
    }

    const nextName = req.body.name?.toString().trim() || bom.name;

    if (nextName !== bom.name) {
      const duplicated = await BillOfMaterial.findOne({
        tenant: tenantId,
        name: nextName,
        _id: { $ne: bom._id },
      });
      if (duplicated) {
        return sendError(res, {
          status: 409,
          code: "BOM_ALREADY_EXISTS",
          message: "Ya existe otra lista de materiales con ese nombre.",
        });
      }
    }

    const updatedIngredients = req.body.ingredients
      ? req.body.ingredients.map((ing) => ({
          product: ing.product || ing.productItemId || null,
          presentationId: ing.presentationId || null,
          quantity: ing.quantity,
        }))
      : bom.ingredients;

    Object.assign(bom, {
      name: nextName,
      product:
        req.body.productId !== undefined
          ? req.body.productId || null
          : bom.product,
      presentationId:
        req.body.presentationId !== undefined
          ? req.body.presentationId || null
          : bom.presentationId,
      yieldQuantity: req.body.yieldQuantity ?? bom.yieldQuantity,
      ingredients: updatedIngredients,
      notes: req.body.notes ?? bom.notes,
    });

    await bom.save();
    await bom.populate(POPULATE_BOM);

    return res.json(bom);
  } catch (error) {
    return handleServerError(res, error, "Error al actualizar lista de materiales");
  }
};

exports.deleteBillOfMaterial = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;
    const bom = await BillOfMaterial.findOneAndUpdate(
      { _id: req.params.id, tenant: tenantId, isActive: { $ne: false } },
      { isActive: false, deletedAt: new Date() },
      { new: true },
    );

    if (!bom) {
      return sendError(res, {
        status: 404,
        code: "BOM_NOT_FOUND",
        message: "Lista de materiales no encontrada",
      });
    }

    return res.json({ message: "Lista de materiales eliminada", bom });
  } catch (error) {
    return handleServerError(res, error, "Error al eliminar lista de materiales");
  }
};

exports.produceBillOfMaterial = async (req, res) => {
  const session = await mongoose.startSession();
  let result = null;
  let businessError = null;
  const lowStockAlerts = [];

  try {
    await session.withTransaction(async () => {
      const tenantId = req.user?.tenant;
      const batches = Math.max(1, Number(req.body.quantity) || 1);
      const notes = req.body.notes?.toString().trim() || "";

      const bom = await BillOfMaterial.findOne({
        _id: req.params.id,
        tenant: tenantId,
        isActive: { $ne: false },
      })
        .populate("ingredients.product")
        .session(session);

      if (!bom) {
        businessError = {
          status: 404,
          code: "BOM_NOT_FOUND",
          message: "Lista de materiales no encontrada",
        };
        throw new Error("BOM_NOT_FOUND");
      }

      // Check stock availability for all ingredients
      const shortages = [];
      for (const ing of bom.ingredients) {
        const needed = ing.quantity * batches;

        if (ing.product) {
          // Product-based ingredient
          if (ing.product.stock < needed) {
            shortages.push({
              supplyName: ing.product.name || "Producto desconocido",
              needed,
              available: ing.product.stock,
              unit: ing.product.unitOfMeasure || "",
            });
          }
        }
      }

      if (shortages.length > 0) {
        businessError = {
          status: 422,
          code: "INSUFFICIENT_STOCK",
          message: "Stock insuficiente para producir",
          details: { shortages },
        };
        throw new Error("INSUFFICIENT_STOCK");
      }

      // Deduct stock and create movements
      for (const ing of bom.ingredients) {
        const needed = ing.quantity * batches;

        if (ing.product) {
          // ── Product ingredient flow ──
          const product = ing.product;
          const stockBefore = product.stock;
          const stockAfter = stockBefore - needed;

          product.stock = stockAfter;
          // product is already populated, but we need the actual doc for save
          // Re-fetch within session to ensure transactional safety
          const productDoc = await Product.findOne({ _id: product._id, tenant: tenantId })
            .session(session);
          if (!productDoc) throw new Error("PRODUCT_NOT_FOUND");

          productDoc.stock = stockAfter;
          await productDoc.save({ session });

          // Collect products that dropped below minimum
          if (product.minStock > 0 && stockAfter <= product.minStock) {
            lowStockAlerts.push({
              _id: product._id,
              name: product.name,
              unit: product.unitOfMeasure || "",
              currentStock: stockAfter,
              minStock: product.minStock,
            });
          }

          await StockMovement.create(
            [
              {
                tenant: tenantId,
                product: product._id,
                type: "SALIDA",
                quantity: needed,
                stockBefore,
                stockAfter,
                reason: `Producción: ${bom.name}${notes ? ` — ${notes}` : ""}`,
                source: "Sistema",
              },
            ],
            { session },
          );
        }
      }

      // If linked to a product, increase its stock and update costPrice
      if (bom.product) {
        const unitsProduced = bom.yieldQuantity * batches;
        const totalIngredientCost = bom.ingredients.reduce((sum, ing) => {
          const cost = ing.product?.costPrice ?? 0;
          return sum + ing.quantity * cost;
        }, 0);
        const costPerUnit = bom.yieldQuantity > 0 ? totalIngredientCost / bom.yieldQuantity : 0;

        const updatePayload = { $inc: { stock: unitsProduced } };
        if (costPerUnit > 0) updatePayload.$set = { costPrice: costPerUnit };

        await Product.findOneAndUpdate(
          { _id: bom.product, tenant: tenantId },
          updatePayload,
          { session },
        );
      }

      const unitsProduced = bom.yieldQuantity * batches;

      await ProductionLog.create(
        [
          {
            tenant: tenantId,
            recipe: bom._id,
            recipeName: bom.name,
            batchesProduced: batches,
            unitsProduced,
            notes,
            producedBy: req.user?._id || null,
          },
        ],
        { session },
      );

      result = {
        billOfMaterial: { _id: bom._id, name: bom.name },
        batchesProduced: batches,
        unitsProduced,
        ingredientsUsed: bom.ingredients.length,
      };
    });
  } catch (error) {
    if (businessError) return sendError(res, businessError);
    return handleServerError(res, error, "Error al producir");
  } finally {
    await session.endSession();
  }

  // Fire-and-forget alerts after transaction commits
  if (req.user?._id && lowStockAlerts.length > 0) {
      for (const prod of lowStockAlerts) {
        notifyLowStock(req.user._id, prod).catch(() => {});
    }
  }

  return res.json(result);
};

exports.getProductionLogs = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
    const page = Math.max(1, Number(req.query.page) || 1);
    const billOfMaterialId = req.query.billOfMaterialId;

    const filter = { tenant: tenantId };
    if (billOfMaterialId) filter.recipe = billOfMaterialId;

    const logs = await ProductionLog.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .skip((page - 1) * limit);

    return res.json(logs);
  } catch (error) {
    return handleServerError(res, error, "Error al obtener historial de producción");
  }
};

exports.getBillOfMaterialProductionLogs = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;
    const logs = await ProductionLog.find({
      tenant: tenantId,
      recipe: req.params.id,
    })
      .sort({ createdAt: -1 })
      .limit(30);

    return res.json(logs);
  } catch (error) {
    return handleServerError(res, error, "Error al obtener historial de la lista de materiales");
  }
};
