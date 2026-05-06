const mongoose = require("mongoose");

const ingredientSchema = new mongoose.Schema(
  {
    supply: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Supply",
      default: null,
    },
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      default: null,
    },
    quantity: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const recipeSchema = new mongoose.Schema(
  {
    tenant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      index: true,
      required: true,
    },
    name: { type: String, required: true },
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      default: null,
    },
    yieldQuantity: { type: Number, default: 1, min: 0 },
    ingredients: [ingredientSchema],
    notes: { type: String, default: "" },
    isActive: { type: Boolean, default: true },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

recipeSchema.index({ tenant: 1, name: 1 }, { unique: true });

module.exports = mongoose.model("Recipe", recipeSchema);
