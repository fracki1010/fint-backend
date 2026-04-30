const mongoose = require("mongoose");

const clientAccountEntrySchema = new mongoose.Schema(
  {
    tenant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      index: true,
      required: true,
    },
    client: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Client",
      required: true,
    },
    date: { type: String, required: true },
    type: {
      type: String,
      enum: ["CHARGE", "PAYMENT", "CREDIT_NOTE", "DEBIT_NOTE"],
      required: true,
    },
    amount: { type: Number, required: true },
    // sign: +1 = client owes us (CHARGE/DEBIT_NOTE), -1 = we owe client (PAYMENT/CREDIT_NOTE)
    sign: { type: Number, enum: [1, -1], required: true },
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      default: null,
    },
    paymentMethod: { type: String, default: "" },
    reference: { type: String, default: "" },
    notes: { type: String, default: "" },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true },
);

clientAccountEntrySchema.index({ tenant: 1, client: 1, date: 1, createdAt: 1 });

module.exports = mongoose.model("ClientAccountEntry", clientAccountEntrySchema);
