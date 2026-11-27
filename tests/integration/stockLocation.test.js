/**
 * @fileoverview Transfers between a deposit and a branch, against a real replica set
 * (transactions need one). Checks totals, rollback on insufficient stock and tenant isolation.
 */

const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

const Location = require("../../src/models/location.model");
const LocationStock = require("../../src/models/locationStock.model");
const StockMovement = require("../../src/models/stockMovement.model");
const { Product } = require("../../src/models/product.model");
const { transferStock } = require("../../src/services/stockLocationService");

let replSet;
const tenant = new mongoose.Types.ObjectId();
const otherTenant = new mongoose.Types.ObjectId();
let deposit;
let gym;
let product;

const stockAt = async (location, productId = product._id) =>
  (await LocationStock.findOne({ location: location._id, product: productId }).lean())?.stock ?? 0;

describe("transferStock", () => {
  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    if (replSet) await replSet.stop();
  });

  beforeEach(async () => {
    await Promise.all([
      Location.deleteMany({}),
      LocationStock.deleteMany({}),
      Product.deleteMany({}),
      StockMovement.deleteMany({}),
    ]);

    deposit = await Location.create({ tenant, name: "Depósito central", kind: "deposito" });
    gym = await Location.create({ tenant, name: "Gimnasio Norte", kind: "sucursal" });
    product = await Product.create({ tenant, name: "Proteína", stock: 10, price: 100, costPrice: 50 });
    await LocationStock.create({ tenant, location: deposit._id, product: product._id, stock: 10 });
  });

  it("moves stock from the deposit to the branch and keeps the tenant total", async () => {
    await transferStock({
      tenantId: tenant,
      fromLocationId: deposit._id,
      toLocationId: gym._id,
      productId: product._id,
      quantity: 4,
    });

    expect(await stockAt(deposit)).toBe(6);
    expect(await stockAt(gym)).toBe(4);

    const refreshed = await Product.findById(product._id).lean();
    expect(refreshed.stock).toBe(10);
  });

  it("records a TRANSFERENCIA movement with both locations", async () => {
    await transferStock({
      tenantId: tenant,
      fromLocationId: deposit._id,
      toLocationId: gym._id,
      productId: product._id,
      quantity: 3,
    });

    const movement = await StockMovement.findOne({ type: "TRANSFERENCIA" }).lean();
    expect(movement.quantity).toBe(3);
    expect(String(movement.fromLocation)).toBe(String(deposit._id));
    expect(String(movement.toLocation)).toBe(String(gym._id));
  });

  it("leaves both locations unchanged when the deposit lacks stock", async () => {
    await expect(
      transferStock({
        tenantId: tenant,
        fromLocationId: deposit._id,
        toLocationId: gym._id,
        productId: product._id,
        quantity: 50,
      }),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_STOCK" });

    expect(await stockAt(deposit)).toBe(10);
    expect(await stockAt(gym)).toBe(0);
    expect(await StockMovement.countDocuments({ type: "TRANSFERENCIA" })).toBe(0);
  });

  it("rejects a branch as source and a deposit as target", async () => {
    await expect(
      transferStock({
        tenantId: tenant,
        fromLocationId: gym._id,
        toLocationId: deposit._id,
        productId: product._id,
        quantity: 1,
      }),
    ).rejects.toMatchObject({ code: "SOURCE_NOT_DEPOSIT" });
  });

  it("rejects the same location on both sides and non-positive quantities", async () => {
    await expect(
      transferStock({
        tenantId: tenant,
        fromLocationId: deposit._id,
        toLocationId: deposit._id,
        productId: product._id,
        quantity: 1,
      }),
    ).rejects.toMatchObject({ code: "SAME_LOCATION" });

    await expect(
      transferStock({
        tenantId: tenant,
        fromLocationId: deposit._id,
        toLocationId: gym._id,
        productId: product._id,
        quantity: 0,
      }),
    ).rejects.toMatchObject({ code: "INVALID_QUANTITY" });
  });

  it("does not use a location that belongs to another tenant", async () => {
    const foreign = await Location.create({ tenant: otherTenant, name: "Ajena", kind: "sucursal" });

    await expect(
      transferStock({
        tenantId: tenant,
        fromLocationId: deposit._id,
        toLocationId: foreign._id,
        productId: product._id,
        quantity: 1,
      }),
    ).rejects.toMatchObject({ code: "LOCATION_NOT_FOUND" });
  });
});
