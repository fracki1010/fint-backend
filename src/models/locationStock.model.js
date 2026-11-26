const mongoose = require("mongoose");

// Stock of one product in one location. Product.stock stays as the tenant-wide total.
const locationStockSchema = new mongoose.Schema(
  {
    tenant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
    },
    location: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Location",
      required: true,
    },
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    stock: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true },
);

locationStockSchema.index({ tenant: 1, location: 1, product: 1 }, { unique: true });
locationStockSchema.index({ tenant: 1, product: 1 });

module.exports = mongoose.model("LocationStock", locationStockSchema);
