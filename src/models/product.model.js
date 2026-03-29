const mongoose = require("mongoose");

const UNIT_OPTIONS = [
  "unidad",
  "caja",
  "paquete",
  "bolsa",
  "botella",
  "kg",
  "g",
  "litro",
  "ml",
  "metro",
];

const productSchema = new mongoose.Schema(
  {
    tenant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      index: true,
      required: true,
    },
    sku: { type: String, sparse: true },
    name: { type: String, required: true },
    description: { type: String },
    price: { type: Number, required: true }, // Precio de venta sugerido
    costPrice: { type: Number }, // Costo de compra
    stock: { type: Number, default: 0 },
    minStock: { type: Number, default: 0 }, // Para alertas de escasez
    category: { type: String },
    categories: [{ type: String }],
    unitOfMeasure: { type: String, enum: UNIT_OPTIONS, default: "unidad" },
    isActive: { type: Boolean, default: true },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

productSchema.index({ tenant: 1, name: 1 }, { unique: true });
productSchema.index({ tenant: 1, sku: 1 }, { unique: true, sparse: true });

module.exports = {
  Product: mongoose.model("Product", productSchema),
  UNIT_OPTIONS,
};
