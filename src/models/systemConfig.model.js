const mongoose = require("mongoose");

const systemConfigSchema = new mongoose.Schema(
  {
    // Singleton: solo debe existir un documento
    key: {
      type: String,
      default: "global",
      unique: true,
      index: true,
    },
    // Precios de complementos (override del config.js)
    complementPricing: {
      type: Map,
      of: Number,
      default: new Map(),
    },
    // Precio base editable
    appBasePrice: {
      type: Number,
      default: 8000,
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("SystemConfig", systemConfigSchema);
