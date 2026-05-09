const mongoose = require("mongoose");
const InventorySnapshot = require("../models/inventorySnapshot.model");
const { Product } = require("../models/product.model");

async function triggerSnapshot({ tenantId, triggeredBy = "manual" }) {
  const products = await Product.find({
    tenant: tenantId,
    isActive: true,
    deletedAt: null,
  }).select("name sku stock costPrice");

  const items = products.map((p) => ({
    productId: p._id,
    productName: p.name,
    sku: p.sku || "",
    stock: p.stock || 0,
    costPrice: p.costPrice || 0,
    stockValue: (p.stock || 0) * (p.costPrice || 0),
  }));

  const totalStockValue = items.reduce((sum, i) => sum + i.stockValue, 0);

  const snapshot = await InventorySnapshot.create({
    tenant: tenantId,
    snapshotDate: new Date(),
    stockValue: totalStockValue,
    productCount: items.length,
    items,
    triggeredBy,
  });

  return snapshot;
}

async function listSnapshots({ tenantId, page = 1, limit = 20 }) {
  const skip = (page - 1) * limit;
  const [snapshots, total] = await Promise.all([
    InventorySnapshot.find({ tenant: tenantId })
      .sort({ snapshotDate: -1 })
      .skip(skip)
      .limit(limit)
      .select("-items")
      .lean(),
    InventorySnapshot.countDocuments({ tenant: tenantId }),
  ]);
  return { snapshots, total, page, limit, totalPages: Math.ceil(total / limit) };
}

async function getSnapshot({ snapshotId, tenantId }) {
  const snapshot = await InventorySnapshot.findOne({
    _id: snapshotId,
    tenant: tenantId,
  }).lean();
  return snapshot;
}

module.exports = { triggerSnapshot, listSnapshots, getSnapshot };
