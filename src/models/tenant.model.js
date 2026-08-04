const mongoose = require("mongoose");

const tenantSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    
    // Plan and Status
    plan: {
      type: String,
      default: "app_base",
    },
    status: {
      type: String,
      enum: ["active", "suspended", "cancelled"],
      default: "active",
    },
    
    // Usage Limits (based on plan)
    limits: {
      maxUsers: { type: Number, default: 5 },
      maxProducts: { type: Number, default: 500 },
      maxOrdersPerMonth: { type: Number, default: 1000 },
    },
    
    // Billing Information
    billing: {
      email: { type: String, trim: true },
      subscriptionStartedAt: { type: Date, default: Date.now },
      subscriptionEndsAt: { type: Date },
      paymentStatus: {
        type: String,
        enum: ["pending", "paid", "overdue"],
        default: "pending",
      },
    },
    
    // Metadata
    metadata: {
      source: { type: String, default: "manual" },
      notes: { type: String, trim: true },
      createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    },
    
    // Experience Mode (progressive feature exposure)
    experienceMode: {
      type: String,
      enum: ["simple", "intermediate", "full"],
      default: "simple",
    },

    // Active complements (e.g. ["expansion", "team_10"])
    complements: [{
      type: String,
    }],

    // Enabled Features (source of truth for feature gating)
    enabledFeatures: [{
      type: String,
    }],
    
    // Current Usage Metrics (updated periodically)
    usage: {
      currentUsers: { type: Number, default: 0 },
      currentProducts: { type: Number, default: 0 },
      ordersThisMonth: { type: Number, default: 0 },
      lastCalculatedAt: { type: Date },
    },

    // Trial Period
    trialEndsAt: { type: Date },
    trialConvertedAt: { type: Date },
  },
  { timestamps: true },
);

// Indexes for common queries
tenantSchema.index({ plan: 1 });
tenantSchema.index({ status: 1 });
tenantSchema.index({ createdAt: -1 });
tenantSchema.index({ "metadata.createdBy": 1 });

module.exports = mongoose.model("Tenant", tenantSchema);
