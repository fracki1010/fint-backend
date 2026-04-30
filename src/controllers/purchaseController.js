const mongoose = require("mongoose");

const Purchase = require("../models/purchase.model");
const { Supply } = require("../models/supply.model");
const SupplyMovement = require("../models/supplyMovement.model");
const SupplierAccountEntry = require("../models/supplierAccountEntry.model");
const { sendError, handleServerError } = require("../utils/http");

exports.getDashboard = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;
    const now = new Date();
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);

    const [
      thisMonthSpend,
      lastMonthSpend,
      pendingCount,
      supplies,
      statusBreakdown,
      monthlySeries,
      topSuppliers,
    ] = await Promise.all([
      // This month RECEIVED total
      Purchase.aggregate([
        {
          $match: {
            tenant: tenantId,
            status: "RECEIVED",
            receivedAt: { $gte: thisMonthStart },
          },
        },
        { $group: { _id: null, total: { $sum: "$total" } } },
      ]),

      // Last month RECEIVED total
      Purchase.aggregate([
        {
          $match: {
            tenant: tenantId,
            status: "RECEIVED",
            receivedAt: { $gte: lastMonthStart, $lt: thisMonthStart },
          },
        },
        { $group: { _id: null, total: { $sum: "$total" } } },
      ]),

      // Pending to receive (CONFIRMED)
      Purchase.countDocuments({ tenant: tenantId, status: "CONFIRMED" }),

      // All active supplies for inventory value + low stock
      Supply.find(
        { tenant: tenantId, isActive: { $ne: false } },
        { currentStock: 1, referenceCost: 1, minStock: 1 },
      ).lean(),

      // Status breakdown (excluding CANCELLED)
      Purchase.aggregate([
        { $match: { tenant: tenantId } },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),

      // Monthly spend trend — last 6 months of RECEIVED purchases
      Purchase.aggregate([
        {
          $match: {
            tenant: tenantId,
            status: "RECEIVED",
            receivedAt: { $gte: sixMonthsAgo },
          },
        },
        {
          $group: {
            _id: {
              year: { $year: "$receivedAt" },
              month: { $month: "$receivedAt" },
            },
            total: { $sum: "$total" },
          },
        },
        { $sort: { "_id.year": 1, "_id.month": 1 } },
      ]),

      // Top 5 suppliers by RECEIVED spend (all time)
      Purchase.aggregate([
        { $match: { tenant: tenantId, status: "RECEIVED" } },
        { $group: { _id: "$supplier", total: { $sum: "$total" } } },
        { $sort: { total: -1 } },
        { $limit: 5 },
        {
          $lookup: {
            from: "clients",
            localField: "_id",
            foreignField: "_id",
            as: "supplierData",
          },
        },
        { $unwind: { path: "$supplierData", preserveNullAndEmpty: true } },
        {
          $project: {
            supplierId: "$_id",
            name: { $ifNull: ["$supplierData.company", "$supplierData.name", "Desconocido"] },
            total: 1,
          },
        },
      ]),
    ]);

    const inventoryValue = supplies.reduce(
      (sum, s) => sum + (s.currentStock || 0) * (s.referenceCost || 0),
      0,
    );
    const lowStockCount = supplies.filter(
      (s) => s.minStock > 0 && s.currentStock <= s.minStock,
    ).length;

    const statusMap = {};
    for (const row of statusBreakdown) statusMap[row._id] = row.count;

    // Build full 6-month series filling gaps with 0
    const monthLabels = [];
    const monthTotals = [];
    const spendByKey = {};
    for (const row of monthlySeries) {
      spendByKey[`${row._id.year}-${row._id.month}`] = row.total;
    }
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${d.getMonth() + 1}`;
      const label = d.toLocaleString("es-AR", { month: "short" });
      monthLabels.push(label.charAt(0).toUpperCase() + label.slice(1));
      monthTotals.push(spendByKey[key] || 0);
    }

    return res.json({
      thisMonthSpend: thisMonthSpend[0]?.total || 0,
      lastMonthSpend: lastMonthSpend[0]?.total || 0,
      pendingCount,
      inventoryValue,
      lowStockCount,
      statusBreakdown: statusMap,
      trend: { labels: monthLabels, totals: monthTotals },
      topSuppliers,
    });
  } catch (error) {
    return handleServerError(res, error, "Error al obtener dashboard de compras");
  }
};

const mapPurchaseWithRelations = async (tenantId, id) =>
  Purchase.findOne({ _id: id, tenant: tenantId })
    .populate("supplier", "name company phone taxId")
    .populate("items.supply", "name sku unit");

exports.getPurchases = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;
    const purchases = await Purchase.find({ tenant: tenantId })
      .populate("supplier", "name company")
      .populate("items.supply", "name unit")
      .sort({ createdAt: -1 });

    return res.json(purchases);
  } catch (error) {
    return handleServerError(res, error, "Error al obtener compras");
  }
};

exports.getPurchaseById = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;
    const purchase = await mapPurchaseWithRelations(tenantId, req.params.id);

    if (!purchase) {
      return sendError(res, {
        status: 404,
        code: "PURCHASE_NOT_FOUND",
        message: "Compra no encontrada",
      });
    }

    return res.json(purchase);
  } catch (error) {
    return handleServerError(res, error, "Error al obtener compra");
  }
};

exports.createPurchase = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;

    const payload = {
      tenant: tenantId,
      supplier: req.body.supplierId,
      date: req.body.date,
      status: "DRAFT",
      paymentCondition: req.body.paymentCondition,
      subtotal: req.body.subtotal,
      tax: req.body.tax,
      total: req.body.total,
      notes: req.body.notes || "",
      items: req.body.items.map((item) => ({
        supply: item.supplyItemId,
        quantity: item.quantity,
        unitCost: item.unitCost,
        lineTotal: item.lineTotal,
      })),
      createdBy: req.user?._id,
    };

    const purchase = await Purchase.create(payload);
    const hydrated = await mapPurchaseWithRelations(tenantId, purchase._id);

    return res.status(201).json(hydrated);
  } catch (error) {
    return handleServerError(res, error, "Error al crear compra");
  }
};

exports.confirmPurchase = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;
    const purchase = await Purchase.findOne({ _id: req.params.id, tenant: tenantId });

    if (!purchase) {
      return sendError(res, {
        status: 404,
        code: "PURCHASE_NOT_FOUND",
        message: "Compra no encontrada",
      });
    }

    if (purchase.status !== "DRAFT") {
      return sendError(res, {
        status: 409,
        code: "INVALID_STATUS_TRANSITION",
        message: "Solo se puede confirmar una compra en estado DRAFT.",
      });
    }

    purchase.status = "CONFIRMED";
    await purchase.save();

    const hydrated = await mapPurchaseWithRelations(tenantId, purchase._id);

    return res.json(hydrated);
  } catch (error) {
    return handleServerError(res, error, "Error al confirmar compra");
  }
};

exports.receivePurchase = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    await session.withTransaction(async () => {
      const tenantId = req.user?.tenant;
      const purchase = await Purchase.findOne({ _id: req.params.id, tenant: tenantId })
        .populate("items.supply")
        .session(session);

      if (!purchase) throw new Error("PURCHASE_NOT_FOUND");
      if (purchase.status !== "CONFIRMED") throw new Error("INVALID_STATUS_TRANSITION");

      for (const item of purchase.items) {
        const supply = await Supply.findOne({
          _id: item.supply._id,
          tenant: tenantId,
          isActive: { $ne: false },
        }).session(session);

        if (!supply) throw new Error("SUPPLY_NOT_FOUND");

        const stockBefore = supply.currentStock;
        const stockAfter = stockBefore + Number(item.quantity);

        supply.currentStock = stockAfter;
        await supply.save({ session });

        await SupplyMovement.create(
          [
            {
              tenant: tenantId,
              supply: supply._id,
              type: "IN",
              quantity: Number(item.quantity),
              stockBefore,
              stockAfter,
              reason: `Recepcion de compra ${purchase._id}`,
              sourceType: "PURCHASE",
              sourceId: String(purchase._id),
              createdBy: req.user?._id,
            },
          ],
          { session },
        );
      }

      if (purchase.paymentCondition === "CREDIT") {
        await SupplierAccountEntry.create(
          [
            {
              tenant: tenantId,
              supplier: purchase.supplier,
              date: purchase.date,
              type: "CHARGE",
              amount: purchase.total,
              sign: 1,
              purchase: purchase._id,
              reference: `Compra ${purchase._id}`,
              notes: "Cargo automático por compra a crédito",
              createdBy: req.user?._id,
            },
          ],
          { session },
        );
      }

      purchase.status = "RECEIVED";
      purchase.receivedAt = new Date();
      await purchase.save({ session });

      const hydrated = await mapPurchaseWithRelations(tenantId, purchase._id);
      res.json(hydrated);
    });
  } catch (error) {
    if (error.message === "PURCHASE_NOT_FOUND") {
      return sendError(res, {
        status: 404,
        code: "PURCHASE_NOT_FOUND",
        message: "Compra no encontrada",
      });
    }
    if (error.message === "INVALID_STATUS_TRANSITION") {
      return sendError(res, {
        status: 409,
        code: "INVALID_STATUS_TRANSITION",
        message: "Solo se puede recibir una compra en estado CONFIRMED.",
      });
    }
    if (error.message === "SUPPLY_NOT_FOUND") {
      return sendError(res, {
        status: 404,
        code: "SUPPLY_NOT_FOUND",
        message: "Insumo no encontrado en items de compra.",
      });
    }

    return handleServerError(res, error, "Error al recibir compra");
  } finally {
    await session.endSession();
  }
};

exports.cancelPurchase = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;
    const purchase = await Purchase.findOne({ _id: req.params.id, tenant: tenantId });

    if (!purchase) {
      return sendError(res, {
        status: 404,
        code: "PURCHASE_NOT_FOUND",
        message: "Compra no encontrada",
      });
    }

    if (!["DRAFT", "CONFIRMED"].includes(purchase.status)) {
      return sendError(res, {
        status: 409,
        code: "INVALID_STATUS_TRANSITION",
        message: "Solo se puede cancelar una compra en estado DRAFT o CONFIRMED.",
      });
    }

    purchase.status = "CANCELLED";
    purchase.cancelledAt = new Date();
    await purchase.save();

    const hydrated = await mapPurchaseWithRelations(tenantId, purchase._id);

    return res.json(hydrated);
  } catch (error) {
    return handleServerError(res, error, "Error al cancelar compra");
  }
};
