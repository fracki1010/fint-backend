const mongoose = require("mongoose");

const snapshotItemSchema = new mongoose.Schema({
  productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
  productName: { type: String, required: true },
  sku: { type: String, default: "" },
  stock: { type: Number, required: true },
  costPrice: { type: Number, default: 0 },
  stockValue: { type: Number, default: 0 },
}, { _id: false });

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
    items: [snapshotItemSchema],
    triggeredBy: {
      type: String,
      enum: ["manual", "auto_close"],
      default: "manual",
    },
  },
  { timestamps: true },
);

inventorySnapshotSchema.index({ tenant: 1, snapshotDate: 1 }, { unique: true });

module.exports = mongoose.model("InventorySnapshot", inventorySnapshotSchema);
