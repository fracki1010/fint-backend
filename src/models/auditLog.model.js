const mongoose = require("mongoose");

const auditLogSchema = new mongoose.Schema(
  {
    action: {
      type: String,
      required: true,
      enum: [
        "tenant.created",
        "tenant.updated",
        "tenant.suspended",
        "tenant.activated",
        "tenant.cancelled",
        "tenant.plan_changed",
        "tenant.limit_changed",
        "tenant.deleted",
        "user.created_by_superadmin",
        "user.deleted_by_superadmin",
      ],
    },
    
    // Who performed the action
    admin: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    
    // Which tenant was affected (if applicable)
    tenant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
    },
    
    // Details of the action
    details: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    
    // HTTP Request info
    ip: {
      type: String,
    },
    userAgent: {
      type: String,
    },
    
    // For filtering by date range
    timestamp: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true },
);

// Indexes for efficient querying
auditLogSchema.index({ action: 1 });
auditLogSchema.index({ admin: 1 });
auditLogSchema.index({ tenant: 1 });
auditLogSchema.index({ timestamp: -1 });
auditLogSchema.index({ createdAt: -1 });

module.exports = mongoose.model("AuditLog", auditLogSchema);
