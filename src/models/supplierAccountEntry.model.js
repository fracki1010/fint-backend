const mongoose = require("mongoose");

const supplierAccountEntrySchema = new mongoose.Schema(
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
    type: {
      type: String,
      enum: ["CHARGE", "PAYMENT", "CREDIT_NOTE", "DEBIT_NOTE"],
      required: true,
    },
    amount: { type: Number, required: true },
    sign: { type: Number, enum: [1, -1], required: true },
    purchase: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Purchase",
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

supplierAccountEntrySchema.index({ tenant: 1, supplier: 1, date: 1, createdAt: 1 });

module.exports = mongoose.model("SupplierAccountEntry", supplierAccountEntrySchema);
