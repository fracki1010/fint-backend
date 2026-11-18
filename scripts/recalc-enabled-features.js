// Recalculates tenant.enabledFeatures from APP_BASE + active complements.
// Needed after the plans change: planMiddleware reads the stored list, so tenants
// created with the old base would lose access to features that are now base.
// Dry run by default. Pass --apply to write.
require("dotenv").config();
const mongoose = require("mongoose");
const Tenant = require("../src/models/tenant.model");
const { deriveEnabledFeatures } = require("../src/config/complementConfig");

const apply = process.argv.includes("--apply");

(async () => {
  await mongoose.connect(process.env.MONGO_URI);

  const tenants = await Tenant.find({}).select("name complements enabledFeatures").lean();
  let changed = 0;

  for (const tenant of tenants) {
    const next = deriveEnabledFeatures(tenant.complements || []).sort();
    const current = [...(tenant.enabledFeatures || [])].sort();
    const same = next.length === current.length && next.every((f, i) => f === current[i]);
    if (same) continue;

    changed += 1;
    const added = next.filter((f) => !current.includes(f));
    const removed = current.filter((f) => !next.includes(f));
    console.log(`${tenant.name || tenant._id}: +[${added.join(", ")}] -[${removed.join(", ")}]`);

    if (apply) {
      await Tenant.updateOne({ _id: tenant._id }, { $set: { enabledFeatures: next } });
    }
  }

  console.log(`${apply ? "Applied" : "Dry run"}: ${changed} of ${tenants.length} tenants ${apply ? "updated" : "would change"}.`);
  await mongoose.disconnect();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
