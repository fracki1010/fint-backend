const treasuryService = require("../services/treasuryService");
const { handleServerError } = require("../utils/http");

/**
 * GET /api/treasury/overview
 * Query: ?from=YYYY-MM-DD&to=YYYY-MM-DD
 */
exports.getOverview = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;
    const { from, to } = req.query;

    const result = await treasuryService.getOverview(tenantId, from, to);
    return res.json(result);
  } catch (error) {
    return handleServerError(
      res,
      error,
      "Error al obtener resumen de tesorería",
    );
  }
};

/**
 * GET /api/treasury/cash-flow
 * Query: ?from=YYYY-MM-DD&to=YYYY-MM-DD&groupBy=month|week|day
 */
exports.getCashFlow = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;
    const { from, to, groupBy } = req.query;

    const result = await treasuryService.getCashFlow(
      tenantId,
      from,
      to,
      groupBy,
    );
    return res.json(result);
  } catch (error) {
    return handleServerError(
      res,
      error,
      "Error al obtener flujo de caja",
    );
  }
};
