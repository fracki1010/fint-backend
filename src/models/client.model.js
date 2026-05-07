const mongoose = require("mongoose");

const clientSchema = new mongoose.Schema(
  {
    tenant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      index: true,
      required: true,
    },
    phone: { type: String, required: true },
    name: { type: String },
    taxId: { type: String, default: "" }, // Documento fiscal del cliente
    email: { type: String },
    address: { type: String },
    fiscalAddress: { type: String, default: "" },
    company: { type: String },
    notes: { type: String },
    // @deprecated: Use account entries to calculate balance
    debt: { type: Number, default: 0 },
    // Credit limit for this client (0 = no limit / unlimited)
    creditLimit: { type: Number, default: 0 },
    // Price list tier assigned to this client (retail, wholesale, distributor)
    priceList: {
      type: String,
      enum: ["retail", "wholesale", "distributor"],
      default: "retail",
    },
    pendingAction: { type: Object, default: null }, // 👈 Nuevo campo para la memoria de confirmación
    pendingSuggestion: { type: Object, default: null },
    conversationHistory: [
      {
        role: { type: String, enum: ["user", "assistant"], required: true },
        message: { type: String, required: true },
        createdAt: { type: Date, default: Date.now },
      },
    ],
    isActive: { type: Boolean, default: true },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

clientSchema.index({ tenant: 1, phone: 1 }, { unique: true });

module.exports = mongoose.model("Client", clientSchema);
