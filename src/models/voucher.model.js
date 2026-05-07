const mongoose = require("mongoose");

const voucherSchema = new mongoose.Schema(
  {
    tenant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      index: true,
      required: true,
    },
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      index: true,
      required: true,
    },
    type: {
      type: String,
      enum: ["invoice", "delivery_note", "receipt"],
      required: true,
    },
    number: {
      type: String,
      required: true,
      index: true,
    },
    sequentialNumber: {
      type: Number,
      required: true,
    },
    year: {
      type: Number,
      required: true,
      default: () => new Date().getFullYear(),
    },
    filePath: {
      type: String,
      required: true,
    },
    fileUrl: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ["active", "voided"],
      default: "active",
    },
    voidReason: {
      type: String,
      default: null,
    },
    voidedAt: {
      type: Date,
      default: null,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    metadata: {
      clientName: { type: String },
      clientTaxId: { type: String },
      totalAmount: { type: Number },
      itemCount: { type: Number },
    },
  },
  { timestamps: true },
);

// Compound indexes for common queries and performance optimization

// Index for order lookups with type (used when fetching vouchers for an order)
voucherSchema.index({ order: 1, type: 1 });

// Unique index to prevent duplicate voucher numbers per tenant
voucherSchema.index({ tenant: 1, number: 1 }, { unique: true });

// Index for listing vouchers by tenant with sorting by creation date
voucherSchema.index({ tenant: 1, createdAt: -1 });

// Index for filtering by tenant, type, and sequential number (counter verification)
voucherSchema.index({ tenant: 1, type: 1, sequentialNumber: 1 });

// Index for status-based queries with date sorting
voucherSchema.index({ tenant: 1, status: 1, createdAt: -1 });

// Index for year-based queries (used in annual reset and reporting)
voucherSchema.index({ tenant: 1, year: 1, type: 1 });

// Compound index for unique active voucher per order/type combination
// This prevents multiple active vouchers of the same type for an order
voucherSchema.index(
  { order: 1, type: 1 },
  {
    unique: true,
    partialFilterExpression: { status: "active" },
  }
);

// Index for metadata-based searches (e.g., finding vouchers by client name)
voucherSchema.index({ tenant: 1, "metadata.clientName": 1 });

// Index for voidedAt date (used in cleanup and audit queries)
voucherSchema.index({ status: 1, voidedAt: -1 }, { sparse: true });

module.exports = mongoose.model("Voucher", voucherSchema);
