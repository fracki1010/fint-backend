const mongoose = require("mongoose");

const receiptItemSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    presentationId: {
      type: mongoose.Schema.Types.ObjectId,
    },
    quantity: { type: Number, required: true, min: 0.001 },
    remittedQty: { type: Number, min: 0 },
    differenceReason: {
      type: String,
      enum: ["", "falta", "sobra", "dañado", "sustitución", "otro"],
      default: "",
    },
    notes: { type: String, default: "" },
    unitCost: { type: Number, required: true, min: 0 },
    lineTotal: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const receiptSchema = new mongoose.Schema(
  {
    tenant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      index: true,
      required: true,
    },
    purchase: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Purchase",
      index: true,
      required: true,
    },
    date: { type: String, required: true },
    notes: { type: String, default: "" },
    items: {
      type: [receiptItemSchema],
      default: [],
      validate: {
        validator: (value) => Array.isArray(value) && value.length > 0,
        message: "El remito debe incluir al menos un item.",
      },
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true },
);

receiptSchema.index({ tenant: 1, createdAt: -1 });
receiptSchema.index({ purchase: 1, createdAt: -1 });

module.exports = mongoose.model("Receipt", receiptSchema);
