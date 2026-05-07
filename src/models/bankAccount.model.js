const mongoose = require("mongoose");

const bankAccountSchema = new mongoose.Schema(
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
    bank: {
      type: String,
      required: true,
      trim: true,
    },
    accountNumber: {
      type: String,
      required: true,
      trim: true,
    },
    type: {
      type: String,
      enum: ["checking", "savings"],
      default: "checking",
    },
    currency: {
      type: String,
      default: "ARS",
      trim: true,
    },
    currentBalance: {
      type: Number,
      default: 0,
      min: 0,
    },
    lastReconciledAt: {
      type: Date,
      default: null,
    },
    lastReconciliationEndDate: {
      type: Date,
      default: null,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  { timestamps: true },
);

// Compound index for tenant-scoped queries
bankAccountSchema.index({ tenant: 1, isActive: 1 });
bankAccountSchema.index({ tenant: 1, name: 1 });

module.exports = mongoose.model("BankAccount", bankAccountSchema);
