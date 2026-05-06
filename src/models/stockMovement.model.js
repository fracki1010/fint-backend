const mongoose = require("mongoose");

const stockMovementSchema = new mongoose.Schema(
  {
    tenant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      index: true,
      required: true,
    },
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    type: {
      type: String,
      enum: ["ENTRADA", "SALIDA", "MERMA", "AJUSTE"],
      required: true,
    },
    quantity: { type: Number, required: true }, // Siempre positivo; el type define si suma o resta
    stockBefore: { type: Number, required: true },
    stockAfter: { type: Number, required: true },
    reason: { type: String }, // Razón detallada (ej: "Compra a proveedor", "Se echó a perder")
    presentationName: { type: String }, // Nombre de la presentación vendida (trazabilidad)
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order", // Opcional, solo si el movimiento fue por una venta
    },
    purchase: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Purchase", // Opcional, solo si el movimiento fue por una compra
      default: null,
    },
    source: {
      type: String,
      enum: ["WhatsApp", "Dashboard", "Sistema"],
      default: "WhatsApp",
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("StockMovement", stockMovementSchema);
