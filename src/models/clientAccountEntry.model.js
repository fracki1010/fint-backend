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
    // --- Reconciliation Fields (PR 1: Core Reconciliation) ---
    dueDate: { type: Date, default: null },
    remainingAmount: { type: Number, default: null },
    status: {
      type: String,
      enum: ["pending", "partial", "paid", "cancelled"],
      default: null,
    },
    allocations: [
      {
        entryId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "ClientAccountEntry",
          required: true,
        },
        amount: { type: Number, required: true },
        date: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true },
);

clientAccountEntrySchema.index({ tenant: 1, client: 1, date: 1, createdAt: 1 });

// --- Performance Indexes for PR 3 (Aging & Allocation Queries) ---

/**
 * Index for quick balance calculations
 * Supports queries filtering by client and status (pending/partial)
 * Used in: getPendingCharges(), allocatePayment(), getAgingReport()
 */
clientAccountEntrySchema.index({ tenant: 1, client: 1, status: 1 });

/**
 * Index for aging report queries
 * Supports efficient bucketing by dueDate
 * Used in: getAgingReport()
 */
clientAccountEntrySchema.index({ tenant: 1, client: 1, dueDate: 1 });

/**
 * Index for FIFO ordering during allocation
 * Combined with status filter for pending charges
 * Used in: allocatePayment() with FIFO strategy
 */
clientAccountEntrySchema.index({ tenant: 1, client: 1, type: 1, status: 1, date: 1, createdAt: 1 });

module.exports = mongoose.model("ClientAccountEntry", clientAccountEntrySchema);
