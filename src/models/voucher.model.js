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

// Compound indexes for common queries
voucherSchema.index({ tenant: 1, order: 1 });
voucherSchema.index({ tenant: 1, type: 1, createdAt: -1 });
voucherSchema.index({ tenant: 1, number: 1 }, { unique: true });
voucherSchema.index({ tenant: 1, status: 1 });
voucherSchema.index({ order: 1, type: 1 }, { unique: true, partialFilterExpression: { status: "active" } });

module.exports = mongoose.model("Voucher", voucherSchema);
