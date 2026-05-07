const mongoose = require("mongoose");

const cashClosingSchema = new mongoose.Schema(
  {
    tenant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      index: true,
    },
    closingNumber: {
      type: String,
      required: true,
      index: true,
    },
    openedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
    closedAt: {
      type: Date,
      default: null,
    },
    status: {
      type: String,
      enum: ["open", "closed", "reopened"],
      default: "open",
      index: true,
    },
    openedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    closedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    // Expected amounts (calculated from orders during closing)
    expectedCash: {
      type: Number,
      default: 0,
    },
    expectedCard: {
      type: Number,
      default: 0,
    },
    expectedTransfer: {
      type: Number,
      default: 0,
    },
    expectedCheck: {
      type: Number,
      default: 0,
    },
    expectedOther: {
      type: Number,
      default: 0,
    },
    expectedTotal: {
      type: Number,
      default: 0,
    },

    // Actual amounts (entered by user when closing)
    actualCash: {
      type: Number,
      default: null,
    },
    actualCard: {
      type: Number,
      default: null,
    },
    actualTransfer: {
      type: Number,
      default: null,
    },
    actualCheck: {
      type: Number,
      default: null,
    },
    actualOther: {
      type: Number,
      default: null,
    },
    actualTotal: {
      type: Number,
      default: null,
    },

    // Discrepancy tracking
    discrepancyCash: {
      type: Number,
      default: 0,
    },
    discrepancyTotal: {
      type: Number,
      default: 0,
    },

    // Summary stats
    orderCount: {
      type: Number,
      default: 0,
    },
    totalSales: {
      type: Number,
      default: 0,
    },
    totalRefunds: {
      type: Number,
      default: 0,
    },
    netSales: {
      type: Number,
      default: 0,
    },

    // Reopening tracking
    reopenedAt: {
      type: Date,
      default: null,
    },
    reopenedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    reopenReason: {
      type: String,
      default: null,
    },

    notes: {
      type: String,
      default: null,
    },
  },
  { timestamps: true },
);

// Compound indexes for common queries

// Unique index to enforce only one open closing per tenant
// Using partial filter expression - only applies to documents where status is "open"
cashClosingSchema.index(
  { tenant: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: { status: "open" },
  },
);

// Index for listing closings by tenant with date sorting
cashClosingSchema.index({ tenant: 1, openedAt: -1 });

// Index for finding closings by date range
cashClosingSchema.index({ tenant: 1, openedAt: 1, closedAt: 1 });

// Index for status-based queries
cashClosingSchema.index({ tenant: 1, status: 1, openedAt: -1 });

module.exports = mongoose.model("CashClosing", cashClosingSchema);
