const mongoose = require("mongoose");

const idempotencyKeySchema = new mongoose.Schema(
  {
    tenant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      index: true,
    },
    scope: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    key: {
      type: String,
      required: true,
      trim: true,
    },
    resourceType: {
      type: String,
      required: true,
      trim: true,
    },
    resourceId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
  },
  { timestamps: true },
);

idempotencyKeySchema.index(
  { tenant: 1, scope: 1, key: 1 },
  { unique: true, name: "uniq_idempotency_key_per_scope" },
);

module.exports = mongoose.model("IdempotencyKey", idempotencyKeySchema);
