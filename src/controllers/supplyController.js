const mongoose = require("mongoose");

const { Supply } = require("../models/supply.model");
const SupplyMovement = require("../models/supplyMovement.model");
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

exports.getSupplies = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;
    const includeInactive = req.query.includeInactive === "true";
    const filter = includeInactive
      ? { tenant: tenantId }
      : { tenant: tenantId, isActive: { $ne: false } };

    const supplies = await Supply.find(filter).sort({ name: 1 });

    return res.json(supplies);
  } catch (error) {
    return handleServerError(res, error, "Error al obtener insumos");
  }
};

exports.createSupply = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;
    const name = req.body.name?.toString().trim();
    const sku = req.body.sku?.trim() ? normalizeSku(req.body.sku) : null;

    const duplicated = await Supply.findOne({
      tenant: tenantId,
      $or: [{ name }, ...(sku ? [{ sku }] : [])],
    });

    if (duplicated) {
      return sendError(res, {
        status: 409,
        code: "SUPPLY_ALREADY_EXISTS",
        message: "Ya existe un insumo con ese nombre o SKU.",
      });
    }

    const created = await Supply.create({
      tenant: tenantId,
      name,
      sku,
      unit: req.body.unit,
      currentStock: req.body.currentStock || 0,
      minStock: req.body.minStock || 0,
      referenceCost: req.body.referenceCost || 0,
      isActive: true,
      deletedAt: null,
    });

    return res.status(201).json(created);
  } catch (error) {
    return handleServerError(res, error, "Error al crear insumo");
  }
};

exports.updateSupply = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;
    const supply = await Supply.findOne({
      _id: req.params.id,
      tenant: tenantId,
      isActive: { $ne: false },
    });

    if (!supply) {
      return sendError(res, {
        status: 404,
        code: "SUPPLY_NOT_FOUND",
        message: "Insumo no encontrado",
      });
    }

    const nextName = req.body.name?.toString().trim() || supply.name;
    const nextSku = req.body.sku?.trim()
      ? normalizeSku(req.body.sku)
      : supply.sku;

    const duplicated = await Supply.findOne({
      tenant: tenantId,
      _id: { $ne: supply._id },
      $or: [{ name: nextName }, ...(nextSku ? [{ sku: nextSku }] : [])],
    });

    if (duplicated) {
      return sendError(res, {
        status: 409,
        code: "SUPPLY_ALREADY_EXISTS",
        message: "Ya existe otro insumo con ese nombre o SKU.",
      });
    }

    Object.assign(supply, {
      name: nextName,
      sku: nextSku,
      unit: req.body.unit ?? supply.unit,
      minStock: req.body.minStock ?? supply.minStock,
      referenceCost: req.body.referenceCost ?? supply.referenceCost,
    });

    await supply.save();

    return res.json(supply);
  } catch (error) {
    return handleServerError(res, error, "Error al actualizar insumo");
  }
};

exports.deleteSupply = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;

    const supply = await Supply.findOneAndUpdate(
      { _id: req.params.id, tenant: tenantId, isActive: { $ne: false } },
      { isActive: false, deletedAt: new Date() },
      { new: true },
    );

    if (!supply) {
      return sendError(res, {
        status: 404,
        code: "SUPPLY_NOT_FOUND",
        message: "Insumo no encontrado",
      });
    }

    return res.json({ message: "Insumo desactivado", supply });
  } catch (error) {
    return handleServerError(res, error, "Error al desactivar insumo");
  }
};

exports.getSupplyMovements = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;

    const movements = await SupplyMovement.find({
      tenant: tenantId,
      supply: req.params.id,
    })
      .populate("supply", "name sku unit")
      .sort({ createdAt: -1 });

    return res.json(movements);
  } catch (error) {
    return handleServerError(res, error, "Error al obtener movimientos de insumo");
  }
};

exports.createSupplyMovement = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    await session.withTransaction(async () => {
      const tenantId = req.user?.tenant;
      const { type, quantity, reason, sourceType } = req.body;

      const supply = await Supply.findOne({
        _id: req.params.id,
        tenant: tenantId,
        isActive: { $ne: false },
      }).session(session);

      if (!supply) {
        throw new Error("SUPPLY_NOT_FOUND");
      }

      const qty = Number(quantity);
      const stockBefore = supply.currentStock;
      let stockAfter = stockBefore;

      if (type === "IN") stockAfter += qty;
      if (type === "OUT") stockAfter -= qty;
      if (type === "ADJUST") stockAfter += qty;

      if (stockAfter < 0) {
        throw new Error("NEGATIVE_STOCK");
      }

      supply.currentStock = stockAfter;
      await supply.save({ session });

      const movement = await SupplyMovement.create(
        [
          {
            tenant: tenantId,
            supply: supply._id,
            type,
            quantity: qty,
            stockBefore,
            stockAfter,
            reason: reason || "",
            sourceType: sourceType || "MANUAL",
            sourceId: req.body.sourceId || null,
            createdBy: req.user?._id,
          },
        ],
        { session },
      );

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
};
