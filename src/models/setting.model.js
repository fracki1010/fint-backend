const mongoose = require("mongoose");
const { UNIT_OPTIONS } = require("./product.model");

const settingSchema = new mongoose.Schema(
  {
    tenant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      index: true,
    },
    storeName: { type: String, default: "Mi Tienda" },
    taxId: { type: String, default: "" }, // CUIT/NIT/RUC de la empresa
    fiscalCondition: { type: String, default: "" }, // Responsable inscripto, etc.
    address: { type: String },
    phone: { type: String },
    email: { type: String },
    supportEmail: { type: String }, // Email remitente para notificaciones
    invoiceTerms: { type: String, default: "" }, // Condiciones comerciales
    admin: {
      fullName: { type: String, default: "" },
      role: { type: String, default: "Administrador" },
      phone: { type: String, default: "" },
      email: { type: String, default: "" },
      company: {
        name: { type: String, default: "" },
        address: { type: String, default: "" },
        phone: { type: String, default: "" },
        email: { type: String, default: "" },
      },
    },
    taxRate: { type: Number, default: 0 }, // IVA en porcentaje
    currency: { type: String, default: "USD" },
    theme: { type: String, default: "light", enum: ["light", "dark"] },
    whatsappEnabled: { type: Boolean, default: true },
    whatsappNumberFormat: {
      type: String,
      enum: ["AR", "INTL"],
      default: "AR",
    },
    whatsappAdminNumber: { type: String, default: "" },
    whatsappAuthorizedNumbers: { type: [String], default: [] },
    lowStockThreshold: { type: Number, default: 5 },
    orderPrefix: { type: String, default: "VTA" },
    orderSequence: { type: Number, default: 0 },
    allowDeliveryWithoutPayment: { type: Boolean, default: false },
    stockDeductionMoment: {
      type: String,
      enum: ["delivery", "confirmation"],
      default: "delivery",
    },
    defaultUnitOfMeasure: {
      type: String,
      enum: UNIT_OPTIONS,
      default: "unidad",
    },
    defaultSalesStatus: {
      type: String,
      enum: ["Pendiente", "Confirmada", "Cancelada"],
      default: "Pendiente",
    },
    defaultPaymentStatus: {
      type: String,
      enum: ["Pendiente", "Parcial", "Pagado"],
      default: "Pendiente",
    },
    defaultDeliveryStatus: {
      type: String,
      enum: ["Pendiente", "Preparando", "Entregada"],
      default: "Pendiente",
    },
    // Price tier configuration: custom names and default discounts per tier
    priceTierConfig: {
      names: {
        type: Map,
        of: String,
        default: {
          retail: "Minorista",
          wholesale: "Mayorista",
          distributor: "Distribuidor",
        },
      },
      defaultDiscounts: {
        type: Map,
        of: Number,
        default: {
          retail: 0,
          wholesale: 10,
          distributor: 20,
        },
      },
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Setting", settingSchema);
