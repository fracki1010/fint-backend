const mongoose = require("mongoose");
const CostCenter = require("../models/costCenter.model");
const Order = require("../models/order.model");
const Purchase = require("../models/purchase.model");
const { sendError, handleServerError } = require("../utils/http");

exports.listCostCenters = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;
    const { includeInactive } = req.query;
    const filter = { tenant: tenantId };
    if (includeInactive !== "true") filter.isActive = true;

    const centers = await CostCenter.find(filter).sort({ name: 1 }).lean();
    return res.json({ success: true, data: centers });
  } catch (error) {
    return handleServerError(res, error, "Error al listar centros de costo");
  }
};

exports.getCostCenter = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;
    const center = await CostCenter.findOne({ _id: req.params.id, tenant: tenantId }).lean();
    if (!center) {
      return sendError(res, { status: 404, code: "NOT_FOUND", message: "Centro de costo no encontrado" });
    }
    return res.json({ success: true, data: center });
  } catch (error) {
    return handleServerError(res, error, "Error al obtener centro de costo");
  }
};

exports.createCostCenter = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;
    const { name, description } = req.body;

    const existing = await CostCenter.findOne({ tenant: tenantId, name });
    if (existing) {
      return sendError(res, { status: 409, code: "DUPLICATE", message: "Ya existe un centro de costo con ese nombre" });
    }

    const center = await CostCenter.create({ tenant: tenantId, name, description });
    return res.status(201).json({ success: true, data: center });
  } catch (error) {
    return handleServerError(res, error, "Error al crear centro de costo");
  }
};

exports.updateCostCenter = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;
    const { name, description, isActive } = req.body;

    const center = await CostCenter.findOne({ _id: req.params.id, tenant: tenantId });
    if (!center) {
      return sendError(res, { status: 404, code: "NOT_FOUND", message: "Centro de costo no encontrado" });
    }

    if (name !== undefined) center.name = name;
    if (description !== undefined) center.description = description;
    if (isActive !== undefined) center.isActive = isActive;

    await center.save();
    return res.json({ success: true, data: center });
  } catch (error) {
    return handleServerError(res, error, "Error al actualizar centro de costo");
  }
};

exports.deleteCostCenter = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;
    const center = await CostCenter.findOne({ _id: req.params.id, tenant: tenantId });
    if (!center) {
      return sendError(res, { status: 404, code: "NOT_FOUND", message: "Centro de costo no encontrado" });
    }
    center.isActive = false;
    await center.save();
    return res.json({ success: true, message: "Centro de costo desactivado" });
  } catch (error) {
    return handleServerError(res, error, "Error al desactivar centro de costo");
  }
};

exports.getCostCenterReport = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;
    const { from, to } = req.query;

    const startDate = from || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
    const endDate = to || new Date().toISOString().slice(0, 10);

    const centers = await CostCenter.find({ tenant: tenantId, isActive: true }).lean();
    const centerMap = new Map();
    centers.forEach((c) => centerMap.set(c._id.toString(), c));

    // Aggregate orders by costCenter
    const orderAgg = await Order.aggregate([
      {
        $match: {
          tenant: tenantId,
          salesStatus: { $ne: "Cancelada" },
          createdAt: { $gte: new Date(startDate), $lte: new Date(endDate + "T23:59:59.999Z") },
        },
      },
      {
        $group: {
          _id: "$costCenter",
          revenue: { $sum: "$totalAmount" },
          orderCount: { $sum: 1 },
        },
      },
    ]);

    // Aggregate purchases by costCenter
    const purchaseAgg = await Purchase.aggregate([
      {
        $match: {
          tenant: tenantId,
          status: { $in: ["CONFIRMED", "RECEIVED"] },
          date: { $gte: startDate, $lte: endDate },
        },
      },
      {
        $group: {
          _id: "$costCenter",
          costs: { $sum: "$total" },
          purchaseCount: { $sum: 1 },
        },
      },
    ]);

    // Build report rows
    const allCenterIds = new Set();
    orderAgg.forEach((r) => { if (r._id) allCenterIds.add(r._id.toString()); });
    purchaseAgg.forEach((r) => { if (r._id) allCenterIds.add(r._id.toString()); });

    // Include unassigned (null costCenter)
    const unassignedOrders = orderAgg.find((r) => !r._id);
    const unassignedPurchases = purchaseAgg.find((r) => !r._id);

    const rows = [];

    for (const centerId of allCenterIds) {
      const center = centerMap.get(centerId);
      const orderRow = orderAgg.find((r) => r._id && r._id.toString() === centerId);
      const purchaseRow = purchaseAgg.find((r) => r._id && r._id.toString() === centerId);
      rows.push({
        _id: centerId,
        name: center?.name || "---",
        revenue: orderRow?.revenue || 0,
        orderCount: orderRow?.orderCount || 0,
        costs: purchaseRow?.costs || 0,
        purchaseCount: purchaseRow?.purchaseCount || 0,
        margin: (orderRow?.revenue || 0) - (purchaseRow?.costs || 0),
      });
    }

    // Add unassigned row
    if (unassignedOrders || unassignedPurchases) {
      rows.push({
        _id: null,
        name: "Sin asignar",
        revenue: unassignedOrders?.revenue || 0,
        orderCount: unassignedOrders?.orderCount || 0,
        costs: unassignedPurchases?.costs || 0,
        purchaseCount: unassignedPurchases?.purchaseCount || 0,
        margin: (unassignedOrders?.revenue || 0) - (unassignedPurchases?.costs || 0),
      });
    }

    const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0);
    const totalCosts = rows.reduce((s, r) => s + r.costs, 0);

    return res.json({
      success: true,
      data: {
        rows,
        totals: {
          revenue: totalRevenue,
          costs: totalCosts,
          margin: totalRevenue - totalCosts,
        },
        dateRange: { from: startDate, to: endDate },
      },
    });
  } catch (error) {
    return handleServerError(res, error, "Error al generar reporte de centros de costo");
  }
};
