const CashMovement = require("../models/cashMovement.model");
const { sendError, handleServerError } = require("../utils/http");

exports.getCashMovements = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;
    const { from, to, category, type, limit: queryLimit, page: queryPage } = req.query;

    const filter = { tenant: tenantId };
    if (from || to) {
      filter.date = {};
      if (from) filter.date.$gte = from;
      if (to) filter.date.$lte = to;
    }
    if (category) filter.category = category;
    if (type) filter.type = type;

    const limit = Math.min(200, Math.max(1, Number(queryLimit) || 50));
    const page = Math.max(1, Number(queryPage) || 1);

    const [movements, total] = await Promise.all([
      CashMovement.find(filter)
        .sort({ date: -1, createdAt: -1 })
        .limit(limit)
        .skip((page - 1) * limit)
        .lean(),
      CashMovement.countDocuments(filter),
    ]);

    // Calculate totals
    const totals = await CashMovement.aggregate([
      { $match: { tenant: tenantId } },
      {
        $group: {
          _id: "$type",
          total: { $sum: "$amount" },
        },
      },
    ]);

    const incomeTotal = totals.find((t) => t._id === "income")?.total || 0;
    const expenseTotal = totals.find((t) => t._id === "expense")?.total || 0;

    res.json({
      movements,
      total,
      incomeTotal,
      expenseTotal,
      balance: incomeTotal - expenseTotal,
      page,
      pages: Math.ceil(total / limit),
    });
  } catch (error) {
    return handleServerError(res, error, "Error al obtener movimientos");
  }
};

exports.createCashMovement = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;

    const movement = await CashMovement.create({
      tenant: tenantId,
      date: req.body.date,
      type: req.body.type,
      category: req.body.category,
      amount: req.body.amount,
      description: req.body.description || "",
      createdBy: req.user?._id,
    });

    res.status(201).json(movement);
  } catch (error) {
    if (error.name === "ValidationError") {
      return sendError(res, {
        status: 400,
        code: "VALIDATION_ERROR",
        message: error.message,
      });
    }
    return handleServerError(res, error, "Error al crear movimiento");
  }
};

exports.deleteCashMovement = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;
    const movement = await CashMovement.findOneAndDelete({
      _id: req.params.id,
      tenant: tenantId,
    });

    if (!movement) {
      return sendError(res, {
        status: 404,
        code: "NOT_FOUND",
        message: "Movimiento no encontrado",
      });
    }

    res.json({ deleted: true });
  } catch (error) {
    return handleServerError(res, error, "Error al eliminar movimiento");
  }
};
