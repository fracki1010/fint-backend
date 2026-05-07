#!/usr/bin/env node
/**
 * Migration: Copy product.price to product.priceTiers.retail
 * 
 * This migration is non-destructive - it only copies data and doesn't delete anything.
 * It preserves backward compatibility by keeping the original price field.
 * 
 * Run with: npm run migrate:prices-to-tiers
 */

require("dotenv").config();
const mongoose = require("mongoose");

const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error("❌ Error: MONGO_URI environment variable is required");
  process.exit(1);
}

// Simple console logger for migration script
const log = {
  info: (msg, meta = {}) => console.log(`ℹ️  ${msg}`, meta),
  success: (msg, meta = {}) => console.log(`✅ ${msg}`, meta),
  error: (msg, meta = {}) => console.error(`❌ ${msg}`, meta),
  warn: (msg, meta = {}) => console.warn(`⚠️  ${msg}`, meta),
};

async function migratePricesToTiers() {
  let connection = null;

  try {
    // Connect to MongoDB
    log.info("Connecting to database...");
    connection = await mongoose.connect(MONGO_URI);
    log.success("Database connected", { host: connection.connection.host });

    // Get the Product collection directly to avoid model dependencies
    const db = connection.connection.db;
    const productsCollection = db.collection("products");

    // Count total products
    const totalProducts = await productsCollection.countDocuments();
    log.info(`Found ${totalProducts} total products`);

    // Find products that have a price field but don't have priceTiers.retail set
    const productsToMigrate = await productsCollection
      .find({
        price: { $exists: true, $ne: null },
        $or: [
          { priceTiers: { $exists: false } },
          { "priceTiers.retail": { $exists: false } },
          { "priceTiers.retail": null },
        ],
      })
      .toArray();

    log.info(`Found ${productsToMigrate.length} products to migrate`);

    if (productsToMigrate.length === 0) {
      log.success("No products need migration - all up to date!");
      return;
    }

    // Migrate products in batches
    const batchSize = 100;
    let migratedCount = 0;
    let errorCount = 0;

    for (let i = 0; i < productsToMigrate.length; i += batchSize) {
      const batch = productsToMigrate.slice(i, i + batchSize);
      const bulkOps = batch.map((product) => ({
        updateOne: {
          filter: { _id: product._id },
          update: {
            $set: {
              "priceTiers.retail": product.price,
            },
          },
        },
      }));

      try {
        const result = await productsCollection.bulkWrite(bulkOps);
        migratedCount += result.modifiedCount;
        log.success(
          `Batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(productsToMigrate.length / batchSize)}: Migrated ${result.modifiedCount} products`
        );
      } catch (batchError) {
        errorCount += batch.length;
        log.error(`Failed to migrate batch: ${batchError.message}`);
      }
    }

    // Summary
    log.success("Migration completed!", {
      totalProducts,
      productsToMigrate: productsToMigrate.length,
      migrated: migratedCount,
      errors: errorCount,
    });

    // Show sample of migrated products
    const sampleProducts = await productsCollection
      .find({
        price: { $exists: true },
        "priceTiers.retail": { $exists: true },
      })
      .limit(3)
      .project({ name: 1, price: 1, priceTiers: 1 })
      .toArray();

    log.info("Sample migrated products:", {
      samples: sampleProducts.map((p) => ({
        name: p.name,
        legacyPrice: p.price,
        retailTier: p.priceTiers?.retail,
      })),
    });

  } catch (error) {
    log.error("Migration failed", { message: error.message, stack: error.stack });
    process.exit(1);
  } finally {
    if (connection) {
      await mongoose.disconnect();
      log.info("Database connection closed");
    }
  }
}

// Run migration if this script is executed directly
if (require.main === module) {
  migratePricesToTiers();
}

module.exports = { migratePricesToTiers };
