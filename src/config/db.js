const mongoose = require("mongoose");
const { logError, logInfo } = require("../utils/logger");

const connectDB = async () => {
  try {
    // Asegúrate de tener MONGO_URI=tu_string_de_conexion en el .env
    const conn = await mongoose.connect(process.env.MONGO_URI);
    logInfo("db_connected", { host: conn.connection.host });
  } catch (error) {
    logError("db_connection_error", { message: error.message });
    process.exit(1);
  }
};

module.exports = connectDB;
