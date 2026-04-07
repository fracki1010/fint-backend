const mongoose = require("mongoose");

const inventorySnapshotSchema = new mongoose.Schema(
  {
    tenant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      index: true,
    },
    snapshotDate: {
      type: Date,
      required: true,
      index: true,
    },
    stockValue: {
      type: Number,
      required: true,
      default: 0,
    },
    productCount: {
      type: Number,
      required: true,
      default: 0,
    },
  },
  { timestamps: true },
);

inventorySnapshotSchema.index({ tenant: 1, snapshotDate: 1 }, { unique: true });

module.exports = mongoose.model("InventorySnapshot", inventorySnapshotSchema);
