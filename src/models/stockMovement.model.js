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
    presentationName: { type: String }, // Nombre de la presentación (trazabilidad)
    presentationId: { type: mongoose.Schema.Types.ObjectId }, // ID de la presentación (trazabilidad)
    presentationEquivalentQty: { type: Number }, // Cantidad equivalente de la presentación (ej: 20 kg por bolsa)
    presentationUnitCost: { type: Number }, // Costo por unidad de presentación (ej: $10.000 por bolsa)
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
