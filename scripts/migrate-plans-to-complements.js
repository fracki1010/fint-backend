#!/usr/bin/env node
/**
 * @fileoverview Migration script: reset ALL tenants to App Base only (no complements).
 *
 * Strategy:
 *   ALL tenants → plan: "app_base", complements: [], enabledFeatures from APP_BASE only
 *
 * Idempotent: skips tenants already on app_base with empty complements.
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });

const mongoose = require("mongoose");
const Tenant = require("../src/models/tenant.model");
const {
  deriveEnabledFeatures,
  deriveLimits,
} = require("../src/config/complementConfig");

const OLD_PLANS = ["essential", "business", "enterprise"];

async function run() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || "mongodb://localhost:27017/fint";

  console.log("[migrate-plans] Connecting to", uri.replace(/\/\/[^:]+:[^@]+@/, "//***:***@"));
  await mongoose.connect(uri);
  console.log("[migrate-plans] Connected.");

  // Count work — include old plans AND any tenant that might still have complements
  const totalToMigrate = await Tenant.countDocuments({
    $or: [
      { plan: { $in: OLD_PLANS } },
      { complements: { $exists: true, $not: { $size: 0 } } },
    ],
  });
  console.log(`[migrate-plans] Tenants to reset to App Base: ${totalToMigrate}`);

  if (totalToMigrate === 0) {
    console.log("[migrate-plans] Nothing to migrate. Exiting.");
    await mongoose.disconnect();
    process.exit(0);
  }

  const cursor = Tenant.find({
    $or: [
      { plan: { $in: OLD_PLANS } },
      { complements: { $exists: true, $not: { $size: 0 } } },
    ],
  }).cursor();

  let processed = 0;
  let skipped = 0;
  let errors = 0;

  for (let tenant = await cursor.next(); tenant != null; tenant = await cursor.next()) {
    try {
      // Idempotency guard: already app_base with empty complements
      if (tenant.plan === "app_base" && Array.isArray(tenant.complements) && tenant.complements.length === 0) {
        skipped += 1;
        continue;
      }

      const enabledFeatures = deriveEnabledFeatures([]);
      const limits = deriveLimits([]);

      tenant.plan = "app_base";
      tenant.complements = [];
      tenant.enabledFeatures = enabledFeatures;
      tenant.limits = limits;

      await tenant.save();
      processed += 1;

      if (processed % 50 === 0) {
        console.log(`[migrate-plans] Processed ${processed}/${totalToMigrate}...`);
      }
    } catch (err) {
      errors += 1;
      console.error(`[migrate-plans] Error resetting tenant ${tenant._id}:`, err.message);
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
