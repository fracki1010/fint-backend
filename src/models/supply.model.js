const mongoose = require("mongoose");

const SUPPLY_UNITS = ["unidad", "kg", "g", "litro", "ml", "metro", "caja", "paquete"];

const supplySchema = new mongoose.Schema(
  {
    tenant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      index: true,
      required: true,
    },
    sku: { type: String, sparse: true },
    name: { type: String, required: true },
    unit: { type: String, enum: SUPPLY_UNITS, default: "unidad" },
    currentStock: { type: Number, default: 0 },
    minStock: { type: Number, default: 0 },
    referenceCost: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

supplySchema.index({ tenant: 1, name: 1 }, { unique: true });
supplySchema.index({ tenant: 1, sku: 1 }, { unique: true, sparse: true });

module.exports = {
  Supply: mongoose.model("Supply", supplySchema),
  SUPPLY_UNITS,
};
