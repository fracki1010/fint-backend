const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const path = require("path");
const fs = require("fs");
const os = require("os");

const { Supply } = require("../../../src/models/supply.model");
const { Product } = require("../../../src/models/product.model");

let mongoServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongoServer.getUri());
});

afterEach(async () => {
  const collections = await mongoose.connection.db.collections();
  for (const col of collections) {
    await col.drop().catch(() => {});
  }
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

/**
 * Dynamically require the migration service AFTER mongoose is connected.
 * This avoids issues with mongoose model compilation order.
 */
async function loadMigrationService() {
  return require("../../../src/services/supplyMigration");
}

describe("migrateSupplyToProduct", () => {
  let tenantId;
  let migrateSupplyToProduct;

  beforeAll(async () => {
    const mod = await loadMigrationService();
    migrateSupplyToProduct = mod.migrateSupplyToProduct;
  });

  beforeEach(() => {
    tenantId = new mongoose.Types.ObjectId();
  });

  describe("field mapping", () => {
    it("creates a Product with correct fields mapped from a Supply", async () => {
      const supply = await Supply.create({
        tenant: tenantId,
        name: "Harina 000",
        sku: "HAR-001",
        unit: "kg",
        currentStock: 50,
        minStock: 10,
        referenceCost: 120.5,
        isActive: true,
      });

      const result = await migrateSupplyToProduct({ models: { Supply, Product } });
      expect(result.created).toHaveLength(1);
      expect(result.skipped).toHaveLength(0);
      expect(result.errors).toHaveLength(0);

      const product = await Product.findById(result.created[0].productId);
      expect(product).not.toBeNull();
      expect(product.type).toBe("raw_material");
      expect(product.name).toBe("Harina 000");
      expect(product.sku).toBe("HAR-001");
      expect(product.stock).toBe(50);
      expect(product.costPrice).toBe(120.5);
      expect(product.unitOfMeasure).toBe("kg");
      expect(product.isActive).toBe(true);
      expect(product.tenant.toString()).toBe(tenantId.toString());

      // Verify supply was NOT modified
      const unchanged = await Supply.findById(supply._id);
      expect(unchanged.currentStock).toBe(50);
    });

    it("maps unitOfMeasure default when Supply has no unit", async () => {
      await Supply.create({
        tenant: tenantId,
        name: "Agua",
        currentStock: 100,
        referenceCost: 10,
        isActive: true,
      });

      const result = await migrateSupplyToProduct({ models: { Supply, Product } });
      expect(result.created).toHaveLength(1);

      const product = await Product.findById(result.created[0].productId);
      expect(product.unitOfMeasure).toBe("unidad");
    });

    it("handles null optional fields (sku, barcode)", async () => {
      await Supply.create({
        tenant: tenantId,
        name: "Genérico",
        currentStock: 0,
        referenceCost: 0,
        isActive: true,
      });

      const result = await migrateSupplyToProduct({ models: { Supply, Product } });
      expect(result.created).toHaveLength(1);

      const product = await Product.findById(result.created[0].productId);
      expect(product.sku).toBeUndefined();
      expect(product.barcode).toBeUndefined();
    });
  });

  describe("duplicate detection", () => {
    it("skips Supply when a Product with same tenant+name already exists", async () => {
      await Supply.create({
        tenant: tenantId,
        name: "Harina 000",
        currentStock: 50,
        referenceCost: 100,
        isActive: true,
      });

      // Create a product with same name+tenant ahead of time
      await Product.create({
        tenant: tenantId,
        name: "Harina 000",
        type: "raw_material",
        price: 0,
        stock: 20,
        costPrice: 90,
      });

      const result = await migrateSupplyToProduct({ models: { Supply, Product } });
      expect(result.created).toHaveLength(0);
      expect(result.skipped).toHaveLength(1);
      expect(result.skipped[0].name).toBe("Harina 000");
      expect(result.errors).toHaveLength(0);
    });

    it("skips only matching name+tenant, creates for different name", async () => {
      // Supply A: will be duplicate
      // Supply B: will be created
      await Supply.create({
        tenant: tenantId,
        name: "Duplicado",
        sku: "DUP-001",
        currentStock: 10,
        isActive: true,
      });
      await Supply.create({
        tenant: tenantId,
        name: "Nuevo",
        sku: "NEW-001",
        currentStock: 20,
        isActive: true,
      });

      await Product.create({
        tenant: tenantId,
        name: "Duplicado",
        type: "raw_material",
        price: 0,
        stock: 5,
      });

      const result = await migrateSupplyToProduct({ models: { Supply, Product } });
      expect(result.errors).toHaveLength(0);
      expect(result.created).toHaveLength(1);
      expect(result.created[0].name).toBe("Nuevo");
      expect(result.skipped).toHaveLength(1);
      expect(result.skipped[0].name).toBe("Duplicado");
    });
  });

  describe("dry-run mode", () => {
    it("does NOT create any documents when dryRun is true", async () => {
      await Supply.create({
        tenant: tenantId,
        name: "Azúcar",
        currentStock: 200,
        referenceCost: 80,
        isActive: true,
      });

      const result = await migrateSupplyToProduct({
        dryRun: true,
        models: { Supply, Product },
      });

      expect(result.created).toHaveLength(1);
      expect(result.created[0].productId).toBe("(dry-run)");

      // Verify no Product documents were actually created
      const products = await Product.find({});
      expect(products).toHaveLength(0);
    });
  });

  describe("edge cases", () => {
    it("handles empty Supply collection without errors", async () => {
      const result = await migrateSupplyToProduct({ models: { Supply, Product } });
      expect(result.created).toHaveLength(0);
      expect(result.skipped).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
    });

    it("creates Product with zero stock when Supply has no currentStock", async () => {
      await Supply.create({
        tenant: tenantId,
        name: "Item sin stock",
        isActive: true,
      });

      const result = await migrateSupplyToProduct({ models: { Supply, Product } });
      expect(result.created).toHaveLength(1);

      const product = await Product.findById(result.created[0].productId);
      expect(product.stock).toBe(0);
      expect(product.costPrice).toBe(0);
    });

    it("only processes active supplies (ignores inactive)", async () => {
      await Supply.create({
        tenant: tenantId,
        name: "Activo",
        sku: "ACT-001",
        currentStock: 10,
        isActive: true,
      });
      await Supply.create({
        tenant: tenantId,
        name: "Inactivo",
        sku: "INACT-001",
        currentStock: 20,
        isActive: false,
      });

      const result = await migrateSupplyToProduct({ models: { Supply, Product } });
      expect(result.created).toHaveLength(1);
      expect(result.created[0].name).toBe("Activo");
    });

    it("returns mapping as JSON-serializable array", async () => {
      await Supply.create({
        tenant: tenantId,
        name: "Mapping test",
        currentStock: 5,
        referenceCost: 50,
        isActive: true,
      });

      const result = await migrateSupplyToProduct({ models: { Supply, Product } });
      expect(result.created).toHaveLength(1);

      const entry = result.created[0];
      expect(entry).toHaveProperty("supplyId");
      expect(entry).toHaveProperty("productId");
      expect(entry).toHaveProperty("name");

      // Should be JSON-safe
      const json = JSON.stringify(result.created);
      expect(() => JSON.parse(json)).not.toThrow();
      const parsed = JSON.parse(json);
      expect(parsed[0].name).toBe("Mapping test");
    });
  });
});
