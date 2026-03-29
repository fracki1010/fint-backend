const AuditLog = require("../models/auditLog.model");
const { handleServerError } = require("../utils/http");

function parseDateValue(raw) {
  if (!raw) return null;
  const parsed = new Date(raw);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function applyDatePreset(filter, datePreset, dateFrom, dateTo) {
  let rangeStart = parseDateValue(dateFrom);
  let rangeEnd = parseDateValue(dateTo);

  if (!rangeStart && !rangeEnd && datePreset) {
    const now = new Date();
    const start = new Date(now);
    const end = new Date(now);

    end.setHours(23, 59, 59, 999);

    if (datePreset === "today") {
      start.setHours(0, 0, 0, 0);
      rangeStart = start;
      rangeEnd = end;
    } else {
      const days = parseInt(datePreset, 10);
      if ([7, 30, 90].includes(days)) {
        start.setHours(0, 0, 0, 0);
        start.setDate(start.getDate() - (days - 1));
        rangeStart = start;
        rangeEnd = end;
      }
    }
  }

  if (rangeStart || rangeEnd) {
    filter.createdAt = {};
    if (rangeStart) filter.createdAt.$gte = rangeStart;
    if (rangeEnd) filter.createdAt.$lte = rangeEnd;
  }
}

exports.getAuditLogs = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;
    const {
      page = 1,
      limit = 30,
      action,
      resourceType,
      userEmail,
      statusCode,
      search,
      datePreset,
      dateFrom,
      dateTo,
    } = req.query;

    const parsedPage = Math.max(parseInt(page, 10) || 1, 1);
    const parsedLimit = Math.max(parseInt(limit, 10) || 30, 1);

    const filter = {
      $or: [{ tenant: tenantId }, { tenant: null }],
    };

    if (action) filter.action = action;
    if (resourceType) filter.resourceType = resourceType;
    if (userEmail) filter.userEmail = userEmail;
    if (statusCode) filter.statusCode = parseInt(statusCode, 10) || 0;

    applyDatePreset(filter, datePreset, dateFrom, dateTo);

    if (search) {
      const searchRegex = new RegExp(String(search).trim(), "i");
      filter.$and = [
        {
          $or: [
            { action: searchRegex },
            { path: searchRegex },
            { resourceType: searchRegex },
            { resourceId: searchRegex },
            { userEmail: searchRegex },
            { requestId: searchRegex },
          ],
        },
      ];
    }

    const [logs, total, actions, resourceTypes, users] = await Promise.all([
      AuditLog.find(filter)
        .sort({ createdAt: -1 })
        .limit(parsedLimit)
        .skip((parsedPage - 1) * parsedLimit),
      AuditLog.countDocuments(filter),
      AuditLog.distinct("action", {
        $or: [{ tenant: tenantId }, { tenant: null }],
      }),
      AuditLog.distinct("resourceType", {
        $or: [{ tenant: tenantId }, { tenant: null }],
        resourceType: { $ne: "" },
      }),
      AuditLog.distinct("userEmail", {
        $or: [{ tenant: tenantId }, { tenant: null }],
        userEmail: { $ne: "" },
      }),
    ]);

    return res.json({
      logs,
      total,
      currentPage: parsedPage,
      totalPages: Math.ceil(total / parsedLimit),
      filterOptions: {
        actions: actions.filter(Boolean).sort(),
        resourceTypes: resourceTypes.filter(Boolean).sort(),
        users: users.filter(Boolean).sort(),
      },
    });
  } catch (error) {
    return handleServerError(res, error, "Error al obtener bitacora");
  }
};
