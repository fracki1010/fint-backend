const mongoose = require("mongoose");
const Location = require("../models/location.model");
const LocationStock = require("../models/locationStock.model");
const { transferStock, loadDepositStock } = require("../services/stockLocationService");
const { resolveLocationScope } = require("../services/locationScope");
const { sendError, handleServerError } = require("../utils/http");

const KINDS = ["deposito", "sucursal"];
const TRANSFER_ERROR_CODES = new Set([
  "INVALID_QUANTITY",
  "SAME_LOCATION",
  "LOCATION_NOT_FOUND",
  "SOURCE_NOT_DEPOSIT",
  "TARGET_NOT_BRANCH",
  "PRODUCT_NOT_FOUND",
  "INSUFFICIENT_STOCK",
]);

const sendScopeError = (res, error) =>
  sendError(res, { status: 403, code: "FORBIDDEN_LOCATION", message: error.message });

exports.listLocations = async (req, res) => {
  try {
    const scope = resolveLocationScope(req.user, null);
    const filter = { tenant: req.user.tenant, isActive: true };
    if (scope) filter._id = scope;

    const locations = await Location.find(filter).sort({ kind: 1, name: 1 }).lean();
    return res.json(locations);
  } catch (error) {
    return handleServerError(res, error, "Error al listar lugares");
  }
};

exports.createLocation = async (req, res) => {
  try {
    const name = req.body.name?.toString().trim();
    const kind = req.body.kind;
    if (!name || !KINDS.includes(kind)) {
      return sendError(res, {
        status: 400,
        code: "VALIDATION_ERROR",
        message: "Nombre requerido y tipo 'deposito' o 'sucursal'.",
      });
    }

    const place = await Location.create({
      tenant: req.user.tenant,
      name,
      kind,
      address: req.body.address?.toString().trim() || "",
    });
    return res.status(201).json(place);
  } catch (error) {
    if (error.code === 11000) {
      return sendError(res, {
        status: 409,
        code: "LOCATION_EXISTS",
        message: "Ya existe un lugar con ese nombre.",
      });
    }
    return handleServerError(res, error, "Error al crear lugar");
  }
};

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const MAX_PAGE_SIZE = 200;

// Without paging params it keeps the full list (used by the transfer picker).
// With q, page or limit it returns one page plus totals, so large catalogs stay light.
exports.getLocationStock = async (req, res) => {
  try {
    const scope = resolveLocationScope(req.user, req.params.id);
    if (!scope) {
      return sendError(res, { status: 400, code: "LOCATION_REQUIRED", message: "Indicá un lugar." });
    }

    const paged = ["q", "page", "limit"].some((key) => req.query[key] !== undefined);

    if (!paged) {
      const rows = await LocationStock.find({ tenant: req.user.tenant, location: scope, stock: { $gt: 0 } })
        .populate("product", "name unitOfMeasure price")
        .sort({ updatedAt: -1 })
        .lean();

      return res.json(
        rows.map((row) => ({
          productId: row.product?._id,
          name: row.product?.name,
          unitOfMeasure: row.product?.unitOfMeasure || "unidad",
          stock: row.stock,
        })),
      );
    }

    const term = String(req.query.q || "").trim();
    // aggregate does not cast ids like find does, so match on real ObjectIds here.
    const base = {
      tenant: new mongoose.Types.ObjectId(req.user.tenant),
      location: new mongoose.Types.ObjectId(scope),
      stock: { $gt: 0 },
    };
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), MAX_PAGE_SIZE);
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);

    const matchName = term
      ? [{ $match: { name: { $regex: escapeRegex(term), $options: "i" } } }]
      : [];

    const [[result = {}] = [], [totals = {}] = []] = await Promise.all([
      LocationStock.aggregate([
        { $match: base },
        { $lookup: { from: "products", localField: "product", foreignField: "_id", as: "product" } },
        { $unwind: "$product" },
        { $project: { stock: 1, name: "$product.name", unitOfMeasure: "$product.unitOfMeasure" } },
        ...matchName,
        { $sort: { name: 1 } },
        {
          $facet: {
            items: [{ $skip: (page - 1) * limit }, { $limit: limit }],
            count: [{ $count: "total" }],
          },
        },
      ]),
      LocationStock.aggregate([
        { $match: base },
        { $group: { _id: null, units: { $sum: "$stock" }, products: { $sum: 1 } } },
      ]),
    ]);

    const total = result.count?.[0]?.total ?? 0;
    return res.json({
      items: (result.items || []).map((row) => ({
        productId: row._id,
        name: row.name,
        unitOfMeasure: row.unitOfMeasure || "unidad",
        stock: row.stock,
      })),
      total,
      page,
      pages: Math.max(1, Math.ceil(total / limit)),
      totalProducts: totals.products ?? 0,
      totalUnits: totals.units ?? 0,
    });
  } catch (error) {
    if (error.code === "FORBIDDEN_LOCATION") return sendScopeError(res, error);
    return handleServerError(res, error, "Error al consultar stock del lugar");
  }
};

exports.loadStock = async (req, res) => {
  try {
    const result = await loadDepositStock({
      tenantId: req.user.tenant,
      depositId: req.params.id,
      productId: req.body.productId,
      quantity: req.body.quantity,
      reason: req.body.reason?.toString().trim() || undefined,
    });
    return res.status(201).json(result);
  } catch (error) {
    if (TRANSFER_ERROR_CODES.has(error.code) || error.code === "TARGET_NOT_DEPOSIT") {
      return sendError(res, { status: 400, code: error.code, message: error.message });
    }
    return handleServerError(res, error, "Error al cargar stock");
  }
};

exports.transfer = async (req, res) => {
  try {
    const result = await transferStock({
      tenantId: req.user.tenant,
      fromLocationId: req.body.fromLocationId,
      toLocationId: req.body.toLocationId,
      productId: req.body.productId,
      quantity: req.body.quantity,
    });
    return res.status(201).json(result);
  } catch (error) {
    if (TRANSFER_ERROR_CODES.has(error.code)) {
      return sendError(res, { status: 400, code: error.code, message: error.message });
    }
    return handleServerError(res, error, "Error al transferir stock");
  }
};
