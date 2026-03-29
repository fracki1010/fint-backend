require("dotenv").config();

const connectDB = require("./src/config/db"); // 👈 1. Importamos la conexión
const { createApp } = require("./src/app");
const { validateRuntimeConfig } = require("./src/config/runtime");
// const { initializeWhatsApp } = require("./src/services/whatsappService"); // Comentado para evitar levantar WhatsApp al iniciar el servidor

const PORT = process.env.PORT || 5000;
const app = createApp();

validateRuntimeConfig();

// 👈 2. EJECUTAMOS LA CONEXIÓN A LA BASE DE DATOS AQUÍ
connectDB();

// Inicializar Bot de WhatsApp
// initializeWhatsApp();

app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en el puerto ${PORT}`);
});
