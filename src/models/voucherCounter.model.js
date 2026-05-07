const mongoose = require("mongoose");

const voucherCounterSchema = new mongoose.Schema(
  {
    tenant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
    },
    type: {
      type: String,
      enum: ["invoice", "delivery_note", "receipt"],
      required: true,
    },
    prefix: {
      type: String,
      required: true,
      default: function () {
        const defaults = {
          invoice: "F-",
          delivery_note: "R-",
          receipt: "D-",
        };
        return defaults[this.type] || "DOC-";
      },
    },
    lastNumber: {
      type: Number,
      default: 0,
    },
    year: {
      type: Number,
      required: true,
      default: () => new Date().getFullYear(),
    },
  },
  { timestamps: true },
);

// Compound unique index to ensure one counter per tenant/type/year
voucherCounterSchema.index({ tenant: 1, type: 1, year: 1 }, { unique: true });

// Index for tenant-based queries
voucherCounterSchema.index({ tenant: 1 });

// Index for year-based queries (used in annual reset functionality)
voucherCounterSchema.index({ tenant: 1, year: 1 });

// Index for finding counters by type across all years (for migration/history)
voucherCounterSchema.index({ tenant: 1, type: 1 });

module.exports = mongoose.model("VoucherCounter", voucherCounterSchema);
