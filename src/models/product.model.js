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

const presentationSchema = new mongoose.Schema(
  {
    sku: { type: String },
    barcode: { type: String },
    name: { type: String, required: true },
    unitOfMeasure: { type: String, enum: UNIT_OPTIONS, default: "unidad" },
    price: { type: Number, min: 0 },
    equivalentQty: { type: Number, default: 1, min: 0.001 },
    isActive: { type: Boolean, default: true },
  },
  { _id: true, timestamps: false },
);

const productSchema = new mongoose.Schema(
  {
    tenant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      index: true,
      required: true,
    },
    sku: { type: String },
    barcode: { type: String },
    name: { type: String, required: true },
    description: { type: String },
    price: { type: Number, required: true }, // Precio de venta sugerido
    costPrice: { type: Number }, // Costo de compra
    stock: { type: Number, default: 0 },
    minStock: { type: Number, default: 0 }, // Para alertas de escasez
    category: { type: String },
    categories: [{ type: String }],
    unitOfMeasure: { type: String, enum: UNIT_OPTIONS, default: "unidad" },
    type: {
      type: String,
      enum: ["raw_material", "finished", "both"],
      default: "both",
    },
    purchaseUnit: { type: String, enum: UNIT_OPTIONS, default: "unidad" },
    purchaseEquivalentQty: { type: Number, default: 1, min: 0.001 },
    costLocked: { type: Boolean, default: false },
    presentations: { type: [presentationSchema], default: [] },
    isActive: { type: Boolean, default: true },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

productSchema.index({ tenant: 1, name: 1 }, { unique: true });
productSchema.index(
  { tenant: 1, sku: 1 },
  {
    unique: true,
    partialFilterExpression: {
      sku: { $type: "string" },
    },
  },
);
productSchema.index(
  { tenant: 1, barcode: 1 },
  {
    unique: true,
    partialFilterExpression: {
      barcode: { $type: "string" },
    },
  },
);

module.exports = {
  Product: mongoose.model("Product", productSchema),
  UNIT_OPTIONS,
};
