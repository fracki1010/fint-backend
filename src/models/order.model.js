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
        quantity: { type: Number, required: true },
        price: { type: Number, required: true },
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
  },
  { timestamps: true },
);

module.exports = mongoose.model("Order", orderSchema);
