const mongoose = require("mongoose");

const paymentSchema = new mongoose.Schema(
  {
    tenant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      index: true,
    },
    plan: {
      type: String,
      enum: ["essential", "business", "enterprise"],
      required: true,
    },
    mercadoPagoPaymentId: {
      type: String,
      index: true,
    },
    mercadoPagoPreferenceId: {
      type: String,
      index: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    currency: {
      type: String,
      default: "ARS",
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected", "cancelled", "refunded"],
      default: "pending",
    },
    paymentMethod: {
      type: String,
    },
    payerEmail: {
      type: String,
    },
    paidAt: {
      type: Date,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
    },
  },
  { timestamps: true },
);

paymentSchema.index({ createdAt: -1 });
paymentSchema.index({ tenant: 1, status: 1 });

module.exports = mongoose.model("Payment", paymentSchema);
