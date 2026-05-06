const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

const {
  createProduct,
  updateProduct,
  lookupProductByCode,
} = require("../../../src/controllers/productController");
const { Product } = require("../../../src/models/product.model");

let mongoServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongoServer.getUri());
});

afterEach(async () => {
  const collections = mongoose.connection.collections;
  for (const collection of Object.values(collections)) {
    await collection.deleteMany({});
  }
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

const mockRes = () => {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  res.setHeader = vi.fn().mockReturnValue(res);
  res.locals = { requestId: "test-req-id" };
  return res;
};

describe("productController - presentation SKU/barcode collisions", () => {
  it("fails when creating a product with a presentation SKU already used by another product", async () => {
    const tenantId = new mongoose.Types.ObjectId();
    await new Product({
      tenant: tenantId,
      sku: "EXISTING-SKU",
      name: "Existing",
      price: 10,
      stock: 10,
    }).save();

    const req = {
      user: { tenant: tenantId },
      body: {
        name: "New Product",
        price: 20,
        presentations: [
          {
            name: "Pres",
            sku: "EXISTING-SKU",
            unitOfMeasure: "kg",
            price: 5,
            equivalentQty: 1,
          },
        ],
      },
    };
    const res = mockRes();
    await createProduct(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ code: "PRODUCT_ALREADY_EXISTS" }),
      }),
    );
  });

  it("fails when creating a product with two presentations sharing the same SKU", async () => {
    const tenantId = new mongoose.Types.ObjectId();
    const req = {
      user: { tenant: tenantId },
      body: {
        name: "New Product",
        price: 20,
        presentations: [
          {
            name: "Pres A",
            sku: "DUP-SKU",
            unitOfMeasure: "kg",
            price: 5,
            equivalentQty: 1,
          },
          {
            name: "Pres B",
            sku: "DUP-SKU",
            unitOfMeasure: "kg",
            price: 6,
            equivalentQty: 2,
          },
        ],
      },
    };
    const res = mockRes();
    await createProduct(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ code: "PRODUCT_ALREADY_EXISTS" }),
      }),
    );
  });

  it("fails when updating a product adding a presentation with a barcode used by another product", async () => {
    const tenantId = new mongoose.Types.ObjectId();
    await new Product({
      tenant: tenantId,
      barcode: "UNIQUE-BAR",
      name: "Other Product",
      price: 10,
      stock: 10,
    }).save();

    const existing = await new Product({
      tenant: tenantId,
      name: "Existing",
      price: 20,
      stock: 10,
    }).save();

    const req = {
      user: { tenant: tenantId },
      params: { id: existing._id.toString() },
      body: {
        presentations: [
          {
            name: "Pres",
            barcode: "UNIQUE-BAR",
            unitOfMeasure: "kg",
            price: 5,
            equivalentQty: 1,
          },
        ],
      },
    };
    const res = mockRes();
    await updateProduct(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ code: "PRODUCT_ALREADY_EXISTS" }),
      }),
    );
  });
});

describe("productController - lookupProductByCode", () => {
  it("creates a product successfully with valid presentations", async () => {
    const tenantId = new mongoose.Types.ObjectId();
    const req = {
      user: { tenant: tenantId },
      body: {
        name: "Product With Presentations",
        price: 50,
        presentations: [
          {
            name: "Caja 10un",
            sku: "CAJA-10",
            barcode: "CAJA-BAR",
            unitOfMeasure: "caja",
            price: 45,
            equivalentQty: 10,
          },
        ],
      },
    };
    const res = mockRes();
    await createProduct(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    const created = res.json.mock.calls[0][0];
    expect(created.presentations).toHaveLength(1);
    expect(created.presentations[0].name).toBe("Caja 10un");
    expect(created.presentations[0].sku).toBe("CAJA-10");
  });

  it("returns base product with matchedPresentation when barcode matches a presentation", async () => {
    const tenantId = new mongoose.Types.ObjectId();
    const product = await new Product({
      tenant: tenantId,
      name: "Base Product",
      price: 10,
      stock: 100,
      presentations: [
        {
          name: "Bolsa 20kg",
          barcode: "PRES-BAR-123",
          unitOfMeasure: "kg",
          price: 100,
          equivalentQty: 20,
        },
      ],
    }).save();

    const req = {
      user: { tenant: tenantId },
      params: { code: "PRES-BAR-123" },
    };
    const res = mockRes();
    await lookupProductByCode(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        products: expect.arrayContaining([
          expect.objectContaining({
            name: "Base Product",
            matchedPresentation: expect.objectContaining({
              name: "Bolsa 20kg",
              barcode: "PRES-BAR-123",
            }),
          }),
        ]),
      }),
    );
  });

  it("returns base product with matchedPresentation when SKU matches a presentation", async () => {
    const tenantId = new mongoose.Types.ObjectId();
    const product = await new Product({
      tenant: tenantId,
      name: "Base Product SKU",
      price: 10,
      stock: 100,
      presentations: [
        {
          name: "Bolsa 5kg",
          sku: "PRES-SKU-456",
          unitOfMeasure: "kg",
          price: 50,
          equivalentQty: 5,
        },
      ],
    }).save();

    const req = {
      user: { tenant: tenantId },
      params: { code: "PRES-SKU-456" },
    };
    const res = mockRes();
    await lookupProductByCode(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        products: expect.arrayContaining([
          expect.objectContaining({
            name: "Base Product SKU",
            matchedPresentation: expect.objectContaining({
              name: "Bolsa 5kg",
              sku: "PRES-SKU-456",
            }),
          }),
        ]),
      }),
    );
  });
});
