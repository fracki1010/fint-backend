const mongoose = require("mongoose");

const supplyMovementSchema = new mongoose.Schema(
  {
    tenant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      index: true,
      required: true,
    },
    supply: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Supply",
      required: true,
    },
    type: {
      type: String,
      enum: ["IN", "OUT", "ADJUST"],
      required: true,
    },
    quantity: { type: Number, required: true },
    stockBefore: { type: Number, required: true },
    stockAfter: { type: Number, required: true },
    reason: { type: String, default: "" },
    sourceType: { type: String, default: "MANUAL" },
    sourceId: { type: String, default: null },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true },
);

supplyMovementSchema.index({ tenant: 1, supply: 1, createdAt: -1 });

module.exports = mongoose.model("SupplyMovement", supplyMovementSchema);
