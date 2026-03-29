const mongoose = require("mongoose");

const connectDB = async () => {
  try {
    // Asegúrate de tener MONGO_URI=tu_string_de_conexion en el .env
    const conn = await mongoose.connect(process.env.MONGO_URI);
    console.log(`📦 MongoDB Conectado: ${conn.connection.host}`);
  } catch (error) {
    console.error(`❌ Error conectando a MongoDB: ${error.message}`);
    process.exit(1);
  }
};

module.exports = connectDB;
