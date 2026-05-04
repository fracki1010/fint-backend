require("dotenv").config();

const connectDB = require("./src/config/db"); // 👈 1. Importamos la conexión
const { createApp } = require("./src/app");
const { validateRuntimeConfig } = require("./src/config/runtime");
const { logInfo } = require("./src/utils/logger");
const { verifyEmailConnection } = require("./src/services/emailService");
// const { initializeWhatsApp } = require("./src/services/whatsappService"); // Comentado para evitar levantar WhatsApp al iniciar el servidor

const PORT = process.env.PORT || 5000;
validateRuntimeConfig();
const app = createApp();

// 👈 2. EJECUTAMOS LA CONEXIÓN A LA BASE DE DATOS AQUÍ
connectDB();

// Inicializar Bot de WhatsApp
// initializeWhatsApp();

app.listen(PORT, () => {
  logInfo("server_started", { port: Number(PORT) });
  verifyEmailConnection();
});
