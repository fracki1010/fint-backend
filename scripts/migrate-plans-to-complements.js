#!/usr/bin/env node
/**
 * @fileoverview Migration script: map old rigid plans to App Base + Complements.
 *
 * Mappings:
 *   essential  → plan: "app_base", complements: [], enabledFeatures from APP_BASE
 *   business   → plan: "app_base", complements: ["expansion","team_10","financiero","bom","produccion"], enabledFeatures from APP_BASE + those complements
 *   enterprise → plan: "app_base", complements: [all], enabledFeatures all features
 *
 * Idempotent: skips tenants already migrated (plan === "app_base" AND complements is non-null).
 */

const mongoose = require("mongoose");
const Tenant = require("../src/models/tenant.model");
const {
  COMPLEMENTS,
  deriveEnabledFeatures,
  deriveLimits,
} = require("../src/config/complementConfig");

const ALL_COMPLEMENT_IDS = Object.keys(COMPLEMENTS);

const PLAN_MAPPING = {
  essential: {
    plan: "app_base",
    complements: [],
  },
  business: {
    plan: "app_base",
    complements: ["expansion", "team_10", "financiero", "bom", "produccion"],
  },
  enterprise: {
    plan: "app_base",
    complements: [...ALL_COMPLEMENT_IDS],
  },
};

async function run() {
  const uri = process.env.MONGODB_URI || "mongodb://localhost:27017/fint";

  console.log("[migrate-plans] Connecting to", uri.replace(/\/\/[^:]+:[^@]+@/, "//***:***@"));
  await mongoose.connect(uri);
  console.log("[migrate-plans] Connected.");

  const oldPlans = Object.keys(PLAN_MAPPING);

  // Count work
  const totalToMigrate = await Tenant.countDocuments({
    plan: { $in: oldPlans },
  });
  console.log(`[migrate-plans] Tenants to migrate: ${totalToMigrate}`);

  if (totalToMigrate === 0) {
    console.log("[migrate-plans] Nothing to migrate. Exiting.");
    await mongoose.disconnect();
    process.exit(0);
  }

  const cursor = Tenant.find({ plan: { $in: oldPlans } }).cursor();
  let processed = 0;
  let skipped = 0;
  let errors = 0;

  for (let tenant = await cursor.next(); tenant != null; tenant = await cursor.next()) {
    try {
      // Idempotency guard: if already app_base with complements array present, skip
      if (tenant.plan === "app_base" && Array.isArray(tenant.complements)) {
        skipped += 1;
        continue;
      }

      const mapping = PLAN_MAPPING[tenant.plan];
      if (!mapping) {
        console.warn(`[migrate-plans] Unknown plan "${tenant.plan}" for tenant ${tenant._id}, skipping.`);
        skipped += 1;
        continue;
      }

      const complements = mapping.complements;
      const enabledFeatures = deriveEnabledFeatures(complements);
      const limits = deriveLimits(complements);

      tenant.plan = mapping.plan;
      tenant.complements = complements;
      tenant.enabledFeatures = enabledFeatures;
      tenant.limits = limits;

      await tenant.save();
      processed += 1;

      if (processed % 50 === 0) {
        console.log(`[migrate-plans] Processed ${processed}/${totalToMigrate}...`);
      }
    } catch (err) {
      errors += 1;
      console.error(`[migrate-plans] Error migrating tenant ${tenant._id}:`, err.message);
    }
  }

  console.log("[migrate-plans] Done.");
  console.log(`  Processed: ${processed}`);
  console.log(`  Skipped:   ${skipped}`);
  console.log(`  Errors:    ${errors}`);

  await mongoose.disconnect();
  process.exit(errors > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error("[migrate-plans] Fatal error:", err.message);
  process.exit(1);
});
