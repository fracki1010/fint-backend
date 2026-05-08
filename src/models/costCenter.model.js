const mongoose = require("mongoose");

const costCenterSchema = new mongoose.Schema(
  {
    tenant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      default: "",
      trim: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true },
);

costCenterSchema.index({ tenant: 1, name: 1 });

module.exports = mongoose.model("CostCenter", costCenterSchema);
