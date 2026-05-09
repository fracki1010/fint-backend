const mongoose = require("mongoose");

const productionLogSchema = new mongoose.Schema(
  {
    tenant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      index: true,
      required: true,
    },
    recipe: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "BillOfMaterial",
      required: true,
    },
    recipeName: { type: String, required: true },
    batchesProduced: { type: Number, required: true },
    unitsProduced: { type: Number, required: true },
    notes: { type: String, default: "" },
    producedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true },
);

productionLogSchema.index({ tenant: 1, createdAt: -1 });
productionLogSchema.index({ tenant: 1, recipe: 1, createdAt: -1 });

module.exports = mongoose.model("ProductionLog", productionLogSchema);
