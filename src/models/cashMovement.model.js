const mongoose = require("mongoose");

const CASH_CATEGORIES = [
  "sueldos",
  "servicios",
  "honorarios",
  "retiro",
  "impuestos",
  "alquiler",
  "fletes",
  "insumos_oficina",
  "varios",
  "deposito",
  "transferencia_entre_cuentas",
];

const cashMovementSchema = new mongoose.Schema(
  {
    tenant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      index: true,
      required: true,
    },
    date: { type: String, required: true },
    type: {
      type: String,
      enum: ["income", "expense"],
      required: true,
    },
    category: {
      type: String,
      enum: CASH_CATEGORIES,
      required: true,
    },
    amount: { type: Number, required: true, min: 1 },
    description: { type: String, default: "" },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true },
);

cashMovementSchema.index({ tenant: 1, date: -1 });
cashMovementSchema.index({ tenant: 1, category: 1 });

module.exports = mongoose.model("CashMovement", cashMovementSchema);
module.exports.CASH_CATEGORIES = CASH_CATEGORIES;
