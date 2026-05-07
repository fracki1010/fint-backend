const mongoose = require("mongoose");

const bankTransactionSchema = new mongoose.Schema(
  {
    tenant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      index: true,
    },
    bankAccount: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "BankAccount",
      required: true,
      index: true,
    },
    date: {
      type: Date,
      required: true,
    },
    description: {
      type: String,
      required: true,
      trim: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    type: {
      type: String,
      enum: ["debit", "credit"],
      required: true,
    },
    reference: {
      type: String,
      trim: true,
      default: null,
    },
    status: {
      type: String,
      enum: ["pending", "cleared", "reconciled"],
      default: "pending",
      index: true,
    },
    reconciliationDate: {
      type: Date,
      default: null,
    },
    matchedEntryType: {
      type: String,
      enum: ["ClientAccountEntry", "SupplierAccountEntry", "Order"],
      default: null,
    },
    matchedEntryId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    notes: {
      type: String,
      trim: true,
      default: null,
    },
  },
  { timestamps: true },
);

// Compound indexes for common queries
bankTransactionSchema.index({ tenant: 1, bankAccount: 1, date: -1 });
bankTransactionSchema.index({ tenant: 1, bankAccount: 1, status: 1 });
bankTransactionSchema.index({ tenant: 1, status: 1 });

module.exports = mongoose.model("BankTransaction", bankTransactionSchema);
