const express = require("express");
const cors = require("cors");
const helmet = require("helmet");

const authMiddleware = require("./middlewares/authMiddleware");
const roleMiddleware = require("./middlewares/roleMiddleware");
const planMiddleware = require("./middlewares/planMiddleware");
const requestContextMiddleware = require("./middlewares/requestContextMiddleware");
const requestLoggerMiddleware = require("./middlewares/requestLoggerMiddleware");
const auditMiddleware = require("./middlewares/auditMiddleware");
const { parseCorsOrigins } = require("./config/runtime");
const { sendError } = require("./utils/http");
const { logError } = require("./utils/logger");

function createApp(options = {}) {
  const allowedOrigins = options.allowedOrigins || parseCorsOrigins();
  const app = express();

  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: "cross-origin" },
    }),
  );
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin)) return callback(null, true);
        return callback(new Error("Origen no permitido por CORS"));
      },
    }),
  );
  app.use(express.json());
  app.use(requestContextMiddleware);
  app.use(requestLoggerMiddleware);
  app.use(auditMiddleware);

  app.use("/api/auth", require("./routes/authRoutes"));
  app.use("/auth", require("./routes/authRoutes"));
  app.use("/api/clients", authMiddleware, planMiddleware.requireFeature("client_account"), require("./routes/clientRoutes"));
  app.use("/api/products", authMiddleware, (req, res, next) => {
    if (req.method === "POST") return planMiddleware.checkLimit("maxProducts")(req, res, next);
    next();
  }, require("./routes/productRoutes"));
  app.use("/api/orders", authMiddleware, (req, res, next) => {
    if (req.method === "POST") return planMiddleware.checkLimit("maxOrdersPerMonth")(req, res, next);
    next();
  }, require("./routes/orderRoutes"));
  app.use("/api/vouchers", authMiddleware, require("./routes/voucher.routes"));
  app.use("/api/settings", authMiddleware, require("./routes/settingRoutes"));
  app.use("/api/tenant", authMiddleware, require("./routes/tenantRoutes"));
  app.use("/api/inventory-snapshots", authMiddleware, require("./routes/inventorySnapshotRoutes"));
  app.use(
    "/api/stock-movements",
    authMiddleware,
    require("./routes/stockMovementRoutes"),
  );
  app.use("/api/dashboard", authMiddleware, require("./routes/dashboardRoutes"));
  app.use("/api/financial", authMiddleware, roleMiddleware.requireRole("admin", "contabilidad"), require("./routes/financialRoutes"));
  app.post(
    "/api/whatsapp/webhook/message",
    express.json({ limit: "25mb" }),
    require("./controllers/whatsappController").handleWebhook,
  );
  app.use("/api/whatsapp", authMiddleware, roleMiddleware.requireRole("admin"), require("./routes/whatsappRoutes"));
  app.use("/api/purchases", authMiddleware, planMiddleware.requireFeature("supplier_account"), require("./routes/purchaseRoutes"));
  app.use("/api/purchases/:purchaseId/receipts", authMiddleware, planMiddleware.requireFeature("supplier_account"), require("./routes/receiptRoutes"));
  app.use("/api/bill-of-materials", authMiddleware, require("./routes/billOfMaterialRoutes"));
  app.use(
    "/api/suppliers",
    authMiddleware,
    planMiddleware.requireFeature("supplier_account"),
    require("./routes/supplierAccountRoutes"),
  );
  app.use("/api/team", authMiddleware, planMiddleware.requireFeature("team_management"), (req, res, next) => {
    if (req.method === "POST") return planMiddleware.checkLimit("maxUsers")(req, res, next);
    next();
  }, require("./routes/teamRoutes"));
  app.use("/api/notifications", require("./routes/notificationRoutes"));
  app.use("/api/audit-logs", authMiddleware, require("./routes/auditLogRoutes"));
  app.use(
    "/api/export",
    authMiddleware,
    roleMiddleware.requireRole("admin", "contabilidad"),
    require("./routes/exportRoutes"),
  );
  app.use(
    "/api/superadmin",
    authMiddleware,
    require("./routes/superAdminRoutes"),
  );
  app.use("/api/payments", authMiddleware, require("./routes/paymentRoutes"));
  // Webhook de pagos no requiere auth (viene de MercadoPago)
  app.post("/api/payments/webhook", express.json(), require("./controllers/paymentController").webhook);
  app.use("/api/cash-closing", authMiddleware, planMiddleware.requireFeature("financial_center"), require("./routes/cashClosingRoutes"));
  app.use("/api/quotes", authMiddleware, planMiddleware.requireFeature("quotes"), require("./routes/quoteRoutes"));
  app.use("/api/banking", authMiddleware, require("./routes/bankingRoutes"));
  app.use(
    "/api/payment-orders",
    authMiddleware,
    require("./routes/paymentOrderRoutes"),
  );
  app.use("/api/cost-centers", authMiddleware, require("./routes/costCenterRoutes"));
  app.use(
    "/api/treasury",
    authMiddleware,
    roleMiddleware.requireRole("admin", "contabilidad"),
    require("./routes/treasuryRoutes"),
  );
  app.use(
    "/api/reports",
    authMiddleware,
    roleMiddleware.requireRole("admin", "contabilidad"),
    require("./routes/reportRoutes"),
  );

  app.get("/api/health", (_req, res) => {
    res.json({ status: "OK", message: "Servidor y Bot funcionando" });
  });

  app.use((err, req, res, _next) => {
    logError("unhandled_error", {
      requestId: req.requestId || res.locals?.requestId || "",
      path: req.originalUrl || req.path || "",
      method: req.method,
      message: err?.message || "unknown_error",
    });

    if (err?.message === "Origen no permitido por CORS") {
      return sendError(res, {
        status: 403,
        code: "CORS_FORBIDDEN",
        message: "Origen no permitido.",
      });
    }

    return sendError(res, {
      status: 500,
      code: "INTERNAL_ERROR",
      message: "Error interno del servidor",
    });
  });

  return app;
}

module.exports = { createApp };
