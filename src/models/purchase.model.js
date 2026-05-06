const mongoose = require("mongoose");

const purchaseItemSchema = new mongoose.Schema(
  {
    supply: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Supply",
    },
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
    },
    quantity: { type: Number, required: true },
    unitCost: { type: Number, required: true },
    lineTotal: { type: Number, required: true },
  },
  { _id: false },
);

const purchaseSchema = new mongoose.Schema(
  {
    tenant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      index: true,
      required: true,
    },
    supplier: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Supplier",
      required: true,
    },
    date: { type: String, required: true },
    status: {
      type: String,
      enum: ["DRAFT", "CONFIRMED", "RECEIVED", "CANCELLED"],
      default: "DRAFT",
    },
    paymentCondition: {
      type: String,
      enum: ["CASH", "CREDIT"],
      default: "CASH",
    },
    subtotal: { type: Number, required: true },
    tax: { type: Number, required: true, default: 0 },
    total: { type: Number, required: true },
    notes: { type: String, default: "" },
    items: {
      type: [purchaseItemSchema],
      default: [],
      validate: [
        {
          validator: (value) => Array.isArray(value) && value.length > 0,
          message: "La compra debe incluir al menos un item.",
        },
        {
          validator: (value) =>
            Array.isArray(value) &&
            value.every((item) => item.supply || item.product),
          message:
            "Cada item debe tener un insumo (supply) o un producto (product).",
        },
      ],
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    receivedAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
  },
  { timestamps: true },
);

purchaseSchema.index({ tenant: 1, createdAt: -1 });
purchaseSchema.index({ tenant: 1, supplier: 1, date: -1 });

module.exports = mongoose.model("Purchase", purchaseSchema);
