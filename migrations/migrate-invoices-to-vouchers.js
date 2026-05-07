#!/usr/bin/env node

/**
 * Migration: Migrate existing invoice PDFs to Voucher system
 * 
 * This script:
 * 1. Scans the facturas_de_ventas/ directory for existing PDFs
 * 2. Creates Voucher records for each found PDF
 * 3. Links vouchers to corresponding orders based on filename patterns
 * 4. Sets counters based on highest existing numbers
 * 
 * Usage: node migrations/migrate-invoices-to-vouchers.js
 */

const mongoose = require("mongoose");
const fs = require("fs").promises;
const path = require("path");
const Voucher = require("../src/models/voucher.model");
const VoucherCounter = require("../src/models/voucherCounter.model");
const Order = require("../src/models/order.model");
const Client = require("../src/models/client.model");
const Setting = require("../src/models/setting.model");
require("dotenv").config();

// Configuration
const INVOICES_DIR = path.join(process.cwd(), "facturas_de_ventas");
const DEFAULT_TENANT_ID = process.env.DEFAULT_TENANT_ID;
const DEFAULT_USER_ID = process.env.DEFAULT_USER_ID;

// Extract order number from filename
// Pattern: factura-venta-{orderRef}-{timestamp}.pdf
const extractOrderRefFromFilename = (filename) => {
  const match = filename.match(/factura-venta-([^-]+)-\d+\.pdf$/);
  return match ? match[1] : null;
};

// Extract sequential number from filename if it exists
const extractNumberFromFilename = (filename) => {
  // Try to find a pattern like F-000123 or similar
  const match = filename.match(/[A-Z]-(\d+)/);
  return match ? parseInt(match[1], 10) : null;
};

// Get file creation year
const getFileYear = async (filePath) => {
  try {
    const stats = await fs.stat(filePath);
    return stats.mtime.getFullYear();
  } catch (error) {
    return new Date().getFullYear();
  }
};

// Find order by reference (orderNumber or _id)
const findOrderByRef = async (ref, tenantId) => {
  if (!ref) return null;

  // Try by orderNumber first
  let order = await Order.findOne({
    tenant: tenantId,
    orderNumber: ref,
  });

  if (order) return order;

  // Try by _id if ref looks like ObjectId
  if (/^[0-9a-fA-F]{24}$/.test(ref)) {
    order = await Order.findOne({
      _id: ref,
      tenant: tenantId,
    });
  }

  return order;
};

// Process a single PDF file
const processPdfFile = async (filePath, tenantId, userId) => {
  const filename = path.basename(filePath);
  const year = await getFileYear(filePath);

  console.log(`Processing: ${filename} (year: ${year})`);

  // Check if already migrated
  const existingVoucher = await Voucher.findOne({
    tenant: tenantId,
    filePath: filePath,
  });

  if (existingVoucher) {
    console.log(`  -> Already migrated as ${existingVoucher.number}`);
    return { skipped: true, voucher: existingVoucher };
  }

  // Extract order reference
  const orderRef = extractOrderRefFromFilename(filename);
  const order = await findOrderByRef(orderRef, tenantId);

  if (!order) {
    console.log(`  -> WARNING: Order not found for ref "${orderRef}"`);
  }

  // Get client info
  let clientName = "Consumidor final";
  let clientTaxId = "";
  if (order?.client) {
    const client = await Client.findById(order.client);
    if (client) {
      clientName = client.name || client.phone || "Consumidor final";
      clientTaxId = client.taxId || "";
    }
  }

  // Generate sequential number
  const sequentialNumber = extractNumberFromFilename(filename) || 1;
  const fullNumber = `F-${String(sequentialNumber).padStart(6, "0")}`;

  // Create voucher record
  const voucher = await Voucher.create({
    tenant: tenantId,
    order: order?._id || null,
    type: "invoice",
    number: fullNumber,
    sequentialNumber,
    year,
    filePath: filePath,
    fileUrl: `/api/vouchers/download/${filename}`,
    status: "active",
    createdBy: userId,
    createdAt: new Date(year, 0, 1), // Approximate date
    updatedAt: new Date(year, 0, 1),
    metadata: {
      clientName,
      clientTaxId,
      totalAmount: order?.totalAmount || 0,
      itemCount: order?.items?.length || 0,
    },
  });

  console.log(`  -> Created voucher ${voucher.number}`);
  return { skipped: false, voucher };
};

// Update or create counter based on highest number
const updateCounters = async (tenantId) => {
  console.log("\nUpdating counters...");

  // Get highest number for invoices
  const highestInvoice = await Voucher.findOne({
    tenant: tenantId,
    type: "invoice",
  }).sort({ sequentialNumber: -1 });

  const currentYear = new Date().getFullYear();
  const highestNumber = highestInvoice?.sequentialNumber || 0;

  console.log(`Highest invoice number found: ${highestNumber}`);

  // Update or create counter
  await VoucherCounter.findOneAndUpdate(
    { tenant: tenantId, type: "invoice", year: currentYear },
    {
      $setOnInsert: {
        tenant: tenantId,
        type: "invoice",
        year: currentYear,
        prefix: "F-",
      },
      $max: { lastNumber: highestNumber },
    },
    { upsert: true, new: true }
  );

  console.log(`Counter updated to ${highestNumber}`);

  // Also create counters for other types if they don't exist
  const otherTypes = ["delivery_note", "receipt"];
  for (const type of otherTypes) {
    await VoucherCounter.findOneAndUpdate(
      { tenant: tenantId, type, year: currentYear },
      {
        $setOnInsert: {
          tenant: tenantId,
          type,
          year: currentYear,
          prefix: type === "delivery_note" ? "R-" : "D-",
          lastNumber: 0,
        },
      },
      { upsert: true, new: true }
    );
  }

  console.log("All counters updated/created");
};

// Main migration function
const migrateInvoices = async () => {
  console.log("=== Migration: Invoices to Vouchers ===\n");

  // Validate environment
  if (!process.env.MONGODB_URI) {
    console.error("ERROR: MONGODB_URI not set");
    process.exit(1);
  }

  try {
    // Connect to database
    console.log("Connecting to database...");
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("Connected\n");

    // Get tenant and user IDs
    const tenantId = DEFAULT_TENANT_ID;
    const userId = DEFAULT_USER_ID;

    if (!tenantId) {
      console.log("WARNING: DEFAULT_TENANT_ID not set, will use first tenant found");
      const firstTenant = await mongoose.connection.db.collection("tenants").findOne({});
      if (!firstTenant) {
        console.error("ERROR: No tenants found in database");
        process.exit(1);
      }
      console.log(`Using tenant: ${firstTenant._id}`);
    }

    if (!userId) {
      console.log("WARNING: DEFAULT_USER_ID not set, will use first user found");
      const firstUser = await mongoose.connection.db.collection("users").findOne({});
      if (!firstUser) {
        console.error("ERROR: No users found in database");
        process.exit(1);
      }
      console.log(`Using user: ${firstUser._id}`);
    }

    const resolvedTenantId = tenantId || firstTenant._id;
    const resolvedUserId = userId || firstUser._id;

    // Check if invoices directory exists
    let files = [];
    try {
      const dirEntries = await fs.readdir(INVOICES_DIR);
      files = dirEntries.filter((f) => f.endsWith(".pdf"));
      console.log(`Found ${files.length} PDF files in ${INVOICES_DIR}\n`);
    } catch (error) {
      if (error.code === "ENOENT") {
        console.log(`Directory ${INVOICES_DIR} does not exist, creating...`);
        await fs.mkdir(INVOICES_DIR, { recursive: true });
        console.log("No existing invoices to migrate\n");
      } else {
        throw error;
      }
    }

    // Process each file
    let processed = 0;
    let skipped = 0;
    let errors = 0;

    for (const filename of files) {
      try {
        const filePath = path.join(INVOICES_DIR, filename);
        const result = await processPdfFile(filePath, resolvedTenantId, resolvedUserId);

        if (result.skipped) {
          skipped++;
        } else {
          processed++;
        }
      } catch (error) {
        console.error(`  -> ERROR processing ${filename}:`, error.message);
        errors++;
      }
    }

    // Update counters
    await updateCounters(resolvedTenantId);

    // Summary
    console.log("\n=== Migration Summary ===");
    console.log(`Total files found: ${files.length}`);
    console.log(`New vouchers created: ${processed}`);
    console.log(`Already migrated (skipped): ${skipped}`);
    console.log(`Errors: ${errors}`);
    console.log("\nMigration complete!");

  } catch (error) {
    console.error("\nMigration failed:", error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log("\nDatabase disconnected");
  }
};

// Run migration
if (require.main === module) {
  migrateInvoices();
}

module.exports = { migrateInvoices };
