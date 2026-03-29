const mongoose = require("mongoose");

const auditLogSchema = new mongoose.Schema(
  {
    tenant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      index: true,
      required: false,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      index: true,
      required: false,
    },
    userEmail: { type: String, default: "" },
    action: { type: String, required: true, index: true },
    method: { type: String, default: "" },
    path: { type: String, default: "", index: true },
    statusCode: { type: Number, default: 0 },
    resourceType: { type: String, default: "", index: true },
    resourceId: { type: String, default: "", index: true },
    ip: { type: String, default: "" },
    userAgent: { type: String, default: "" },
    requestId: { type: String, default: "", index: true },
    metadata: { type: Object, default: {} },
  },
  { timestamps: true },
);

auditLogSchema.index({ tenant: 1, createdAt: -1 });

module.exports = mongoose.model("AuditLog", auditLogSchema);
