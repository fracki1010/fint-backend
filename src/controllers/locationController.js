const Location = require("../models/location.model");
const LocationStock = require("../models/locationStock.model");
const { transferStock } = require("../services/stockLocationService");
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

exports.getLocationStock = async (req, res) => {
  try {
    const scope = resolveLocationScope(req.user, req.params.id);
    if (!scope) {
      return sendError(res, { status: 400, code: "LOCATION_REQUIRED", message: "Indicá un lugar." });
    }

    const rows = await LocationStock.find({
      tenant: req.user.tenant,
      location: scope,
      stock: { $gt: 0 },
    })
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
  } catch (error) {
    if (error.code === "FORBIDDEN_LOCATION") return sendScopeError(res, error);
    return handleServerError(res, error, "Error al consultar stock del lugar");
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
