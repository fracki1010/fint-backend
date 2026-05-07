#!/usr/bin/env node

/**
 * @fileoverview Cleanup script for old voucher PDFs
 * Archives vouchers older than 2 years and removes PDF files while keeping database records.
 * 
 * Usage:
 *   node cleanupOldVouchers.js [--dry-run] [--older-than-days=730]
 * 
 * Options:
 *   --dry-run              Show what would be deleted without actually deleting
 *   --older-than-days=N    Delete vouchers older than N days (default: 730 = 2 years)
 *   --archive-path=PATH    Path to archive directory (default: ./archived-vouchers)
 */

const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");

// Parse command line arguments
const args = process.argv.slice(2);
const isDryRun = args.includes("--dry-run");
const olderThanDaysArg = args.find((arg) => arg.startsWith("--older-than-days="));
const archivePathArg = args.find((arg) => arg.startsWith("--archive-path="));

const OLDER_THAN_DAYS = olderThanDaysArg
  ? parseInt(olderThanDaysArg.split("=")[1], 10)
  : 730; // 2 years default

const ARCHIVE_PATH = archivePathArg
  ? archivePathArg.split("=")[1]
  : path.join(process.cwd(), "archived-vouchers");

const CUTOFF_DATE = new Date();
CUTOFF_DATE.setDate(CUTOFF_DATE.getDate() - OLDER_THAN_DAYS);

// Load models
const Voucher = require("../src/models/voucher.model");

// Statistics
const stats = {
  scanned: 0,
  archived: 0,
  deleted: 0,
  errors: 0,
  spaceReclaimed: 0,
};

/**
 * Ensure archive directory exists
 */
function ensureArchiveDir() {
  if (!fs.existsSync(ARCHIVE_PATH)) {
    if (!isDryRun) {
      fs.mkdirSync(ARCHIVE_PATH, { recursive: true });
      console.log(`Created archive directory: ${ARCHIVE_PATH}`);
    } else {
      console.log(`[DRY RUN] Would create archive directory: ${ARCHIVE_PATH}`);
    }
  }
}

/**
 * Archive a voucher PDF to cold storage
 */
async function archiveVoucher(voucher) {
  try {
    if (!fs.existsSync(voucher.filePath)) {
      console.log(`  PDF not found: ${voucher.filePath}`);
      return false;
    }

    const fileName = path.basename(voucher.filePath);
    const archiveFilePath = path.join(ARCHIVE_PATH, fileName);

    if (!isDryRun) {
      // Copy to archive
      fs.copyFileSync(voucher.filePath, archiveFilePath);
      
      // Verify copy succeeded
      if (!fs.existsSync(archiveFilePath)) {
        throw new Error("Archive copy verification failed");
      }
    }

    console.log(`  Archived: ${fileName}`);
    return true;
  } catch (error) {
    console.error(`  Error archiving voucher ${voucher._id}:`, error.message);
    stats.errors++;
    return false;
  }
}

/**
 * Delete a voucher PDF file
 */
async function deleteVoucherPdf(voucher) {
  try {
    if (!fs.existsSync(voucher.filePath)) {
      console.log(`  PDF already deleted: ${voucher.filePath}`);
      return true;
    }

    const stats = fs.statSync(voucher.filePath);
    
    if (!isDryRun) {
      fs.unlinkSync(voucher.filePath);
    }

    stats.spaceReclaimed += stats.size;
    console.log(`  Deleted: ${path.basename(voucher.filePath)} (${formatBytes(stats.size)})`);
    return true;
  } catch (error) {
    console.error(`  Error deleting voucher ${voucher._id}:`, error.message);
    stats.errors++;
    return false;
  }
}

/**
 * Update voucher record to mark PDF as archived
 */
async function markVoucherArchived(voucher) {
  try {
    if (!isDryRun) {
      await Voucher.updateOne(
        { _id: voucher._id },
        {
          $set: {
            filePath: null,
            fileUrl: null,
            archivedAt: new Date(),
            archivedPath: path.join(ARCHIVE_PATH, path.basename(voucher.filePath)),
          },
        }
      );
    }
    return true;
  } catch (error) {
    console.error(`  Error marking voucher ${voucher._id} as archived:`, error.message);
    stats.errors++;
    return false;
  }
}

/**
 * Find empty directories and remove them
 */
function cleanupEmptyDirectories(basePath) {
  try {
    if (!fs.existsSync(basePath)) return;

    const items = fs.readdirSync(basePath);
    
    for (const item of items) {
      const itemPath = path.join(basePath, item);
      const stat = fs.statSync(itemPath);

      if (stat.isDirectory()) {
        cleanupEmptyDirectories(itemPath);
        
        // Check if directory is now empty
        const remainingItems = fs.readdirSync(itemPath);
        if (remainingItems.length === 0) {
          if (!isDryRun) {
            fs.rmdirSync(itemPath);
          }
          console.log(`  ${isDryRun ? "[DRY RUN] Would remove" : "Removed"} empty directory: ${itemPath}`);
        }
      }
    }
  } catch (error) {
    console.error(`Error cleaning up directories:`, error.message);
  }
}

/**
 * Format bytes to human readable string
 */
function formatBytes(bytes) {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

/**
 * Main cleanup function
 */
async function runCleanup() {
  console.log("=".repeat(60));
  console.log("Voucher PDF Cleanup Script");
  console.log("=".repeat(60));
  console.log(`Mode: ${isDryRun ? "DRY RUN (no changes will be made)" : "LIVE"}`);
  console.log(`Cutoff date: ${CUTOFF_DATE.toISOString()}`);
  console.log(`Archive path: ${ARCHIVE_PATH}`);
  console.log(`Max age: ${OLDER_THAN_DAYS} days (${(OLDER_THAN_DAYS / 365).toFixed(1)} years)`);
  console.log("=".repeat(60));
  console.log();

  if (isDryRun) {
    console.log("⚠️  DRY RUN MODE - No files will be deleted or modified\n");
  }

  try {
    // Ensure archive directory exists
    ensureArchiveDir();

    // Connect to database
    console.log("Connecting to database...");
    const mongoUri = process.env.MONGODB_URI || "mongodb://localhost:27017/fint";
    await mongoose.connect(mongoUri);
    console.log("Connected to database\n");

    // Find old vouchers
    console.log("Scanning for old vouchers...");
    const oldVouchers = await Voucher.find({
      createdAt: { $lt: CUTOFF_DATE },
      status: { $in: ["active", "voided"] },
      filePath: { $ne: null },
    }).sort({ createdAt: 1 });

    stats.scanned = oldVouchers.length;
    console.log(`Found ${oldVouchers.length} vouchers older than ${OLDER_THAN_DAYS} days\n`);

    if (oldVouchers.length === 0) {
      console.log("No vouchers to clean up.");
      return;
    }

    // Process each voucher
    console.log("Processing vouchers...");
    for (const voucher of oldVouchers) {
      console.log(`\nVoucher ${voucher.number} (${voucher.type}) - Created: ${voucher.createdAt}`);

      // Archive the PDF
      const archived = await archiveVoucher(voucher);
      if (archived) {
        stats.archived++;
      }

      // Delete the PDF
      const deleted = await deleteVoucherPdf(voucher);
      if (deleted) {
        stats.deleted++;
      }

      // Mark as archived in database
      await markVoucherArchived(voucher);
    }

    // Cleanup empty directories
    console.log("\nCleaning up empty directories...");
    const comprobantesPath = path.join(process.cwd(), "comprobantes");
    cleanupEmptyDirectories(comprobantesPath);

    // Print summary
    console.log("\n" + "=".repeat(60));
    console.log("CLEANUP SUMMARY");
    console.log("=".repeat(60));
    console.log(`Vouchers scanned:     ${stats.scanned}`);
    console.log(`PDFs archived:        ${stats.archived}`);
    console.log(`PDFs deleted:         ${stats.deleted}`);
    console.log(`Errors encountered:   ${stats.errors}`);
    console.log(`Space reclaimed:      ${formatBytes(stats.spaceReclaimed)}`);
    console.log("=".repeat(60));

    if (isDryRun) {
      console.log("\n⚠️  This was a dry run. No changes were made.");
      console.log("Run without --dry-run to perform actual cleanup.");
    }

  } catch (error) {
    console.error("\nFatal error during cleanup:", error.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log("\nDisconnected from database.");
  }
}

// Handle uncaught errors
process.on("uncaughtException", (error) => {
  console.error("Uncaught exception:", error);
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled rejection at:", promise, "reason:", reason);
  process.exit(1);
});

// Run the cleanup
runCleanup();
