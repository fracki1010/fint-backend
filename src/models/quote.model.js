const mongoose = require("mongoose");

const quoteSchema = new mongoose.Schema(
  {
    tenant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      index: true,
    },
    client: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Client",
      required: true,
    },
    quoteNumber: { type: String, index: true },
    date: { type: String, required: true },
    expirationDate: { type: String, default: "" },
    status: {
      type: String,
      enum: ["DRAFT", "SENT", "ACCEPTED", "CONVERTED", "REJECTED"],
      default: "DRAFT",
    },
    items: [
      {
        product: { type: String, required: true },
        productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product", default: null },
        presentationId: { type: mongoose.Schema.Types.ObjectId, default: null },
        quantity: { type: Number, required: true },
        price: { type: Number, required: true },
        lineTotal: { type: Number, required: true },
      },
    ],
    subtotal: { type: Number, required: true },
    tax: { type: Number, default: 0 },
    total: { type: Number, required: true },
    notes: { type: String, default: "" },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    convertedToOrder: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      default: null,
    },
  },
  { timestamps: true },
);

quoteSchema.index({ tenant: 1, createdAt: -1 });

module.exports = mongoose.model("Quote", quoteSchema);
