#!/usr/bin/env node
/**
 * Migration: Initialize account entry reconciliation fields
 *
 * This migration sets up the new fields for the reconciliation system:
 * - dueDate: Set to createdAt + 30 days for existing CHARGE entries
 * - remainingAmount: Set to amount for pending entries
 * - status: Set to 'pending' for entries without allocations
 * - creditLimit: Set to 0 for all clients (no limit by default)
 *
 * Run with: node migrations/migrate-account-entries.js
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

async function migrateAccountEntries() {
  let connection = null;

  try {
    // Connect to MongoDB
    log.info("Connecting to database...");
    connection = await mongoose.connect(MONGO_URI);
    log.success("Database connected", { host: connection.connection.host });

    const db = connection.connection.db;
    const entriesCollection = db.collection("clientaccountentries");
    const clientsCollection = db.collection("clients");

    // Count total entries
    const totalEntries = await entriesCollection.countDocuments();
    log.info(`Found ${totalEntries} total account entries`);

    // Count total clients
    const totalClients = await clientsCollection.countDocuments();
    log.info(`Found ${totalClients} total clients`);

    // --- Migrate Client Account Entries ---

    // 1. Find CHARGE entries without dueDate
    const chargesWithoutDueDate = await entriesCollection
      .find({
        type: "CHARGE",
        $or: [{ dueDate: { $exists: false } }, { dueDate: null }],
      })
      .toArray();

    log.info(
      `Found ${chargesWithoutDueDate.length} CHARGE entries without dueDate`
    );

    // 2. Update CHARGE entries with dueDate = createdAt + 30 days
    let dueDateUpdated = 0;
    for (const entry of chargesWithoutDueDate) {
      const createdAt = entry.createdAt || new Date();
      const dueDate = new Date(createdAt);
      dueDate.setDate(dueDate.getDate() + 30);

      await entriesCollection.updateOne(
        { _id: entry._id },
        { $set: { dueDate } }
      );
      dueDateUpdated++;
    }

    log.success(`Updated dueDate for ${dueDateUpdated} CHARGE entries`);

    // 3. Find CHARGE/DEBIT_NOTE entries without remainingAmount
    const chargesWithoutRemaining = await entriesCollection
      .find({
        type: { $in: ["CHARGE", "DEBIT_NOTE"] },
        $or: [{ remainingAmount: { $exists: false } }, { remainingAmount: null }],
      })
      .toArray();

    log.info(
      `Found ${chargesWithoutRemaining.length} charge entries without remainingAmount`
    );

    // 4. Update charge entries with remainingAmount = amount - allocated
    let remainingUpdated = 0;
    for (const entry of chargesWithoutRemaining) {
      const allocated =
        entry.allocations?.reduce((sum, alloc) => sum + alloc.amount, 0) || 0;
      const remainingAmount = Math.max(0, entry.amount - allocated);

      await entriesCollection.updateOne(
        { _id: entry._id },
        { $set: { remainingAmount } }
      );
      remainingUpdated++;
    }

    log.success(
      `Updated remainingAmount for ${remainingUpdated} charge entries`
    );

    // 5. Find entries without status
    const entriesWithoutStatus = await entriesCollection
      .find({
        $or: [{ status: { $exists: false } }, { status: null }],
      })
      .toArray();

    log.info(`Found ${entriesWithoutStatus.length} entries without status`);

    // 6. Set status based on entry type and allocations
    let statusUpdated = 0;
    for (const entry of entriesWithoutStatus) {
      let status;

      if (entry.type === "PAYMENT" || entry.type === "CREDIT_NOTE") {
        status = "paid";
      } else {
        // CHARGE or DEBIT_NOTE
        const allocated =
          entry.allocations?.reduce((sum, alloc) => sum + alloc.amount, 0) || 0;
        const remaining = entry.remainingAmount ?? entry.amount - allocated;

        if (remaining <= 0) {
          status = "paid";
        } else if (allocated > 0) {
          status = "partial";
        } else {
          status = "pending";
        }
      }

      await entriesCollection.updateOne({ _id: entry._id }, { $set: { status } });
      statusUpdated++;
    }

    log.success(`Updated status for ${statusUpdated} entries`);

    // --- Migrate Clients ---

    // 7. Find clients without creditLimit
    const clientsWithoutCreditLimit = await clientsCollection
      .find({
        $or: [
          { creditLimit: { $exists: false } },
          { creditLimit: null },
        ],
      })
      .toArray();

    log.info(
      `Found ${clientsWithoutCreditLimit.length} clients without creditLimit`
    );

    // 8. Set creditLimit = 0 for all clients (0 means no limit)
    let creditLimitUpdated = 0;
    for (const client of clientsWithoutCreditLimit) {
      await clientsCollection.updateOne(
        { _id: client._id },
        { $set: { creditLimit: 0 } }
      );
      creditLimitUpdated++;
    }

    log.success(`Updated creditLimit for ${creditLimitUpdated} clients`);

    // --- Summary ---

    log.success("Migration completed successfully!", {
      totalEntries,
      totalClients,
      dueDateUpdated,
      remainingUpdated,
      statusUpdated,
      creditLimitUpdated,
    });

    // Show sample of migrated entries
    const sampleEntries = await entriesCollection
      .find({ type: "CHARGE" })
      .limit(3)
      .project({
        type: 1,
        amount: 1,
        dueDate: 1,
        remainingAmount: 1,
        status: 1,
      })
      .toArray();

    log.info("Sample migrated CHARGE entries:", { samples: sampleEntries });
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
  migrateAccountEntries();
}

module.exports = { migrateAccountEntries };
