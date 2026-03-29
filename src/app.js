const express = require("express");
const cors = require("cors");
const helmet = require("helmet");

const authMiddleware = require("./middlewares/authMiddleware");
const auditMiddleware = require("./middlewares/auditMiddleware");
const { parseCorsOrigins } = require("./config/runtime");
const { sendError } = require("./utils/http");

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
  app.use(auditMiddleware);

  app.use("/api/auth", require("./routes/authRoutes"));
  app.use("/auth", require("./routes/authRoutes"));
  app.use("/api/clients", authMiddleware, require("./routes/clientRoutes"));
  app.use("/api/products", authMiddleware, require("./routes/productRoutes"));
  app.use("/api/orders", authMiddleware, require("./routes/orderRoutes"));
  app.use("/api/settings", authMiddleware, require("./routes/settingRoutes"));
  app.use(
    "/api/stock-movements",
    authMiddleware,
    require("./routes/stockMovementRoutes"),
  );
  app.use("/api/dashboard", authMiddleware, require("./routes/dashboardRoutes"));
  app.use("/api/whatsapp", authMiddleware, require("./routes/whatsappRoutes"));
  app.use("/api/notifications", require("./routes/notificationRoutes"));
  app.use("/api/audit-logs", authMiddleware, require("./routes/auditLogRoutes"));

  app.get("/api/health", (_req, res) => {
    res.json({ status: "OK", message: "Servidor y Bot funcionando" });
  });

  app.use((err, _req, res, _next) => {
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
