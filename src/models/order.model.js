const mongoose = require("mongoose");

const orderSchema = new mongoose.Schema(
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
    items: [
      {
        product: { type: String, required: true }, // Nombre extraído por la IA
        productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product" },
        presentationId: { type: mongoose.Schema.Types.ObjectId, default: null },
        quantity: { type: Number, required: true },
        price: { type: Number, required: true },
        unitCostAtSale: { type: Number, default: 0 },
      },
    ],
    totalAmount: { type: Number, required: true },
    orderNumber: { type: String, index: true },
    status: {
      type: String,
      enum: ["Pendiente", "Pagado", "Entregado", "Confirmada", "Cancelada"],
      default: "Pendiente",
    },
    salesStatus: {
      type: String,
      enum: ["Pendiente", "Confirmada", "Cancelada"],
      default: "Pendiente",
    },
    paymentStatus: {
      type: String,
      enum: ["Pendiente", "Parcial", "Pagado"],
      default: "Pendiente",
    },
    paymentMethod: { type: String, default: "" },
    paymentSplits: [{
      method: { type: String },
      amount: { type: Number },
    }],
    deliveryStatus: {
      type: String,
      enum: ["Pendiente", "Preparando", "Entregada"],
      default: "Pendiente",
    },
    notes: { type: String },
    confirmedAt: { type: Date, default: null },
    paidAt: { type: Date, default: null },
    deliveredAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
    stockApplied: { type: Boolean, default: false },
    stockAppliedAt: { type: Date, default: null },
    imageUrl: { type: String }, // Aquí guardaremos la foto del pedido si la hay
    source: {
      type: String,
      enum: ["WhatsApp", "Dashboard"],
      default: "WhatsApp",
    },
    cashClosing: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CashClosing",
      default: null,
      index: true,
    },
    costCenter: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CostCenter",
      default: null,
    },
  },
  { timestamps: true },
);

orderSchema.index({ tenant: 1, createdAt: -1 });
orderSchema.index({ tenant: 1, salesStatus: 1, createdAt: -1 });
orderSchema.index({ tenant: 1, paymentStatus: 1, createdAt: -1 });
orderSchema.index({ tenant: 1, client: 1, createdAt: -1 });

module.exports = mongoose.model("Order", orderSchema);
