const mongoose = require("mongoose");

const supplierSchema = new mongoose.Schema(
  {
    tenant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      index: true,
      required: true,
    },
    name: { type: String, required: true, trim: true },
    company: { type: String, default: "", trim: true },
    taxId: { type: String, default: "", trim: true },
    phone: { type: String, default: "", trim: true },
    email: { type: String, default: "", trim: true },
    address: { type: String, default: "", trim: true },
    notes: { type: String, default: "" },
    isActive: { type: Boolean, default: true },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

supplierSchema.index({ tenant: 1, name: 1 });

module.exports = mongoose.model("Supplier", supplierSchema);
