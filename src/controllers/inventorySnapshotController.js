const inventorySnapshotService = require("../services/inventorySnapshotService");
const { sendError, handleServerError } = require("../utils/http");

async function trigger(req, res) {
  try {
    const snapshot = await inventorySnapshotService.triggerSnapshot({
      tenantId: req.user.tenant,
      triggeredBy: "manual",
    });
    return res.status(201).json({
      success: true,
      message: "Snapshot de inventario creado exitosamente",
      data: snapshot,
    });
  } catch (error) {
    return handleServerError(res, error, "Error al crear snapshot de inventario");
  }
}

async function list(req, res) {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const result = await inventorySnapshotService.listSnapshots({
      tenantId: req.user.tenant,
      page,
      limit,
    });
    return res.status(200).json({
      success: true,
      data: result.snapshots,
      pagination: {
        page: result.page,
        limit: result.limit,
        total: result.total,
        totalPages: result.totalPages,
      },
    });
  } catch (error) {
    return handleServerError(res, error, "Error al listar snapshots de inventario");
  }
}

async function getById(req, res) {
  try {
    const snapshot = await inventorySnapshotService.getSnapshot({
      snapshotId: req.params.id,
      tenantId: req.user.tenant,
    });
    if (!snapshot) {
      return sendError(res, {
        status: 404,
        code: "NOT_FOUND",
        message: "Snapshot no encontrado",
      });
    }
    return res.status(200).json({
      success: true,
      data: snapshot,
    });
  } catch (error) {
    return handleServerError(res, error, "Error al obtener snapshot de inventario");
  }
}

module.exports = { trigger, list, getById };
