const mongoose = require("mongoose");

const paymentOrderItemSchema = new mongoose.Schema(
  {
    purchase: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Purchase",
      required: true,
    },
    amount: { type: Number, required: true },
  },
  { _id: false },
);

const paymentOrderSchema = new mongoose.Schema(
  {
    tenant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      index: true,
    },
    supplier: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Supplier",
      required: true,
    },
    date: { type: String, required: true },
    paymentMethod: { type: String, default: "transfer" },
    reference: { type: String, default: "" },
    notes: { type: String, default: "" },
    status: {
      type: String,
      enum: ["DRAFT", "PAID", "CANCELLED"],
      default: "DRAFT",
    },
    items: {
      type: [paymentOrderItemSchema],
      default: [],
      validate: {
        validator: (value) => Array.isArray(value) && value.length > 0,
        message: "La orden de pago debe incluir al menos un item.",
      },
    },
    total: { type: Number, required: true },
    paidAt: { type: Date, default: null },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true },
);

paymentOrderSchema.index({ tenant: 1, createdAt: -1 });
paymentOrderSchema.index({ tenant: 1, supplier: 1, date: -1 });
paymentOrderSchema.index({ tenant: 1, status: 1 });

module.exports = mongoose.model("PaymentOrder", paymentOrderSchema);
