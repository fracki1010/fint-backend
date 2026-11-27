const mongoose = require("mongoose");

// A place that holds stock: the central deposit, or a point of sale such as a gym.
const locationSchema = new mongoose.Schema(
  {
    tenant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    kind: {
      type: String,
      enum: ["deposito", "sucursal"],
      required: true,
    },
    address: { type: String, default: "" },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

locationSchema.index({ tenant: 1, name: 1 }, { unique: true });

module.exports = mongoose.model("Location", locationSchema);
