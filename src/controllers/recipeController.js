const mongoose = require("mongoose");

const Recipe = require("../models/recipe.model");
const Supply = require("../models/supply.model");
const SupplyMovement = require("../models/supplyMovement.model");
const ProductionLog = require("../models/productionLog.model");
const { Product } = require("../models/product.model");
const { sendError, handleServerError } = require("../utils/http");
const { notifyLowStock } = require("../utils/stockAlerts");

const POPULATE_RECIPE = [
  { path: "product", select: "name sku" },
  { path: "ingredients.supply", select: "name unit currentStock referenceCost" },
];

exports.getRecipes = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;
    const includeInactive = req.query.includeInactive === "true";
    const filter = includeInactive
      ? { tenant: tenantId }
      : { tenant: tenantId, isActive: { $ne: false } };

    const recipes = await Recipe.find(filter)
      .populate(POPULATE_RECIPE)
      .sort({ name: 1 });

    return res.json(recipes);
  } catch (error) {
    return handleServerError(res, error, "Error al obtener recetas");
  }
};

exports.getRecipeById = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;
    const recipe = await Recipe.findOne({
      _id: req.params.id,
      tenant: tenantId,
      isActive: { $ne: false },
    }).populate(POPULATE_RECIPE);

    if (!recipe) {
      return sendError(res, {
        status: 404,
        code: "RECIPE_NOT_FOUND",
        message: "Receta no encontrada",
      });
    }

    return res.json(recipe);
  } catch (error) {
    return handleServerError(res, error, "Error al obtener receta");
  }
};

exports.createRecipe = async (req, res) => {
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

    const duplicated = await Recipe.findOne({ tenant: tenantId, name });
    if (duplicated) {
      return sendError(res, {
        status: 409,
        code: "RECIPE_ALREADY_EXISTS",
        message: "Ya existe una receta con ese nombre.",
      });
    }

    const created = await Recipe.create({
      tenant: tenantId,
      name,
      product: req.body.productId || null,
      yieldQuantity: req.body.yieldQuantity || 1,
      ingredients: req.body.ingredients || [],
      notes: req.body.notes || "",
      isActive: true,
      deletedAt: null,
    });

    await created.populate(POPULATE_RECIPE);

    return res.status(201).json(created);
  } catch (error) {
    return handleServerError(res, error, "Error al crear receta");
  }
};

exports.updateRecipe = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;
    const recipe = await Recipe.findOne({
      _id: req.params.id,
      tenant: tenantId,
      isActive: { $ne: false },
    });

    if (!recipe) {
      return sendError(res, {
        status: 404,
        code: "RECIPE_NOT_FOUND",
        message: "Receta no encontrada",
      });
    }

    const nextName = req.body.name?.toString().trim() || recipe.name;

    if (nextName !== recipe.name) {
      const duplicated = await Recipe.findOne({
        tenant: tenantId,
        name: nextName,
        _id: { $ne: recipe._id },
      });
      if (duplicated) {
        return sendError(res, {
          status: 409,
          code: "RECIPE_ALREADY_EXISTS",
          message: "Ya existe otra receta con ese nombre.",
        });
      }
    }

    Object.assign(recipe, {
      name: nextName,
      product:
        req.body.productId !== undefined
          ? req.body.productId || null
          : recipe.product,
      yieldQuantity: req.body.yieldQuantity ?? recipe.yieldQuantity,
      ingredients: req.body.ingredients ?? recipe.ingredients,
      notes: req.body.notes ?? recipe.notes,
    });

    await recipe.save();
    await recipe.populate(POPULATE_RECIPE);

    return res.json(recipe);
  } catch (error) {
    return handleServerError(res, error, "Error al actualizar receta");
  }
};

exports.deleteRecipe = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;
    const recipe = await Recipe.findOneAndUpdate(
      { _id: req.params.id, tenant: tenantId, isActive: { $ne: false } },
      { isActive: false, deletedAt: new Date() },
      { new: true },
    );

    if (!recipe) {
      return sendError(res, {
        status: 404,
        code: "RECIPE_NOT_FOUND",
        message: "Receta no encontrada",
      });
    }

    return res.json({ message: "Receta eliminada", recipe });
  } catch (error) {
    return handleServerError(res, error, "Error al eliminar receta");
  }
};

exports.produceRecipe = async (req, res) => {
  const session = await mongoose.startSession();
  let result = null;
  let businessError = null;
  const lowStockAlerts = [];

  try {
    await session.withTransaction(async () => {
      const tenantId = req.user?.tenant;
      const batches = Math.max(1, Number(req.body.quantity) || 1);
      const notes = req.body.notes?.toString().trim() || "";

      const recipe = await Recipe.findOne({
        _id: req.params.id,
        tenant: tenantId,
        isActive: { $ne: false },
      })
        .populate("ingredients.supply")
        .session(session);

      if (!recipe) {
        businessError = {
          status: 404,
          code: "RECIPE_NOT_FOUND",
          message: "Receta no encontrada",
        };
        throw new Error("RECIPE_NOT_FOUND");
      }

      // Check stock availability for all ingredients
      const shortages = [];
      for (const ing of recipe.ingredients) {
        const supply = ing.supply;
        const needed = ing.quantity * batches;
        if (!supply || supply.currentStock < needed) {
          shortages.push({
            supplyName: supply?.name || "Insumo desconocido",
            needed,
            available: supply?.currentStock ?? 0,
            unit: supply?.unit || "",
          });
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

      // Deduct stock and create supply movements
      for (const ing of recipe.ingredients) {
        const supply = ing.supply;
        const needed = ing.quantity * batches;
        const stockBefore = supply.currentStock;
        const stockAfter = stockBefore - needed;

        supply.currentStock = stockAfter;
        await supply.save({ session });

        // Collect supplies that dropped below minimum
        if (supply.minStock > 0 && stockAfter <= supply.minStock) {
          lowStockAlerts.push({
            _id: supply._id,
            name: supply.name,
            unit: supply.unit,
            currentStock: stockAfter,
            minStock: supply.minStock,
          });
        }

        await SupplyMovement.create(
          [
            {
              tenant: tenantId,
              supply: supply._id,
              type: "OUT",
              quantity: needed,
              stockBefore,
              stockAfter,
              reason: `Producción: ${recipe.name}${notes ? ` — ${notes}` : ""}`,
              sourceType: "PRODUCTION",
              sourceId: recipe._id.toString(),
              createdBy: req.user?._id || null,
            },
          ],
          { session },
        );
      }

      // If linked to a product, increase its stock
      if (recipe.product) {
        const unitsProduced = recipe.yieldQuantity * batches;
        await Product.findOneAndUpdate(
          { _id: recipe.product, tenant: tenantId },
          { $inc: { stock: unitsProduced } },
          { session },
        );
      }

      const unitsProduced = recipe.yieldQuantity * batches;

      await ProductionLog.create(
        [
          {
            tenant: tenantId,
            recipe: recipe._id,
            recipeName: recipe.name,
            batchesProduced: batches,
            unitsProduced,
            notes,
            producedBy: req.user?._id || null,
          },
        ],
        { session },
      );

      result = {
        recipe: { _id: recipe._id, name: recipe.name },
        batchesProduced: batches,
        unitsProduced,
        ingredientsUsed: recipe.ingredients.length,
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
    for (const supply of lowStockAlerts) {
      notifyLowStock(req.user._id, supply).catch(() => {});
    }
  }

  return res.json(result);
};

exports.getProductionLogs = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
    const page = Math.max(1, Number(req.query.page) || 1);
    const recipeId = req.query.recipeId;

    const filter = { tenant: tenantId };
    if (recipeId) filter.recipe = recipeId;

    const logs = await ProductionLog.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .skip((page - 1) * limit);

    return res.json(logs);
  } catch (error) {
    return handleServerError(res, error, "Error al obtener historial de producción");
  }
};

exports.getRecipeProductionLogs = async (req, res) => {
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
    return handleServerError(res, error, "Error al obtener historial de la receta");
  }
};
