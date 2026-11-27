/**
 * @fileoverview Place-level stock on sales and owner loads, against a real replica set.
 * A sale takes stock from the place it was made from (or the central deposit), a revert gives it back,
 * the owner loads stock into a deposit, and a sucursal user is limited to selling and viewing stock.
 */

const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

const Location = require("../../src/models/location.model");
const LocationStock = require("../../src/models/locationStock.model");
const StockMovement = require("../../src/models/stockMovement.model");
const { Product } = require("../../src/models/product.model");
const { loadDepositStock } = require("../../src/services/stockLocationService");
const { applyStockForOrder, revertStockForOrder } = require("../../src/controllers/orderController");
const { isSucursalAllowed } = require("../../src/middlewares/authMiddleware");

let replSet;
const tenant = new mongoose.Types.ObjectId();
let deposit;
let branch;
let product;

const stockAt = async (location) =>
  (await LocationStock.findOne({ location: location._id, product: product._id }).lean())?.stock ?? 0;

const saleFor = (placeId) => ({
  _id: new mongoose.Types.ObjectId(),
  location: placeId,
  items: [{ productId: product._id, product: product.name, quantity: 3 }],
});

describe("place-level stock flow", () => {
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
    branch = await Location.create({ tenant, name: "Gimnasio Norte", kind: "sucursal" });
    product = await Product.create({ tenant, name: "Proteína", stock: 10, price: 100, costPrice: 50 });
    await LocationStock.create({ tenant, location: deposit._id, product: product._id, stock: 10 });
  });

  it("a sale from a branch takes stock from that branch and from the tenant total", async () => {
    await LocationStock.create({ tenant, location: branch._id, product: product._id, stock: 5 });
    // Mirror the transfer that would have moved 5 units to the branch: total is 10, deposit 10, branch 5.
    await LocationStock.updateOne({ location: deposit._id, product: product._id }, { $inc: { stock: -5 } });
    const session = await mongoose.startSession();
    await session.withTransaction(() => applyStockForOrder(saleFor(branch._id), session, "Venta", "Dashboard", tenant));
    await session.endSession();

    expect(await stockAt(branch)).toBe(2);
    expect(await stockAt(deposit)).toBe(5);
    expect((await Product.findById(product._id).lean()).stock).toBe(7);
  });

  it("a sale without a place takes stock from the central deposit", async () => {
    const session = await mongoose.startSession();
    await session.withTransaction(() => applyStockForOrder(saleFor(null), session, "Venta", "Dashboard", tenant));
    await session.endSession();

    expect(await stockAt(deposit)).toBe(7);
  });

  it("refuses a sale larger than the place stock and leaves totals untouched", async () => {
    const session = await mongoose.startSession();
    await expect(
      session.withTransaction(() => applyStockForOrder(saleFor(branch._id), session, "Venta", "Dashboard", tenant)),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_STOCK" });
    await session.endSession();

    expect((await Product.findById(product._id).lean()).stock).toBe(10);
  });

  it("reverting a sale gives the stock back to the same place", async () => {
    const order = saleFor(null);
    const session = await mongoose.startSession();
    await session.withTransaction(() => applyStockForOrder(order, session, "Venta", "Dashboard", tenant));
    await session.withTransaction(() => revertStockForOrder(order, session, "Dashboard", tenant));
    await session.endSession();

    expect(await stockAt(deposit)).toBe(10);
    expect((await Product.findById(product._id).lean()).stock).toBe(10);
  });

  it("the owner loads stock into a deposit and the tenant total grows", async () => {
    const result = await loadDepositStock({ tenantId: tenant, depositId: deposit._id, productId: product._id, quantity: 4 });

    expect(result.stock).toBe(14);
    expect(await stockAt(deposit)).toBe(14);
    expect((await Product.findById(product._id).lean()).stock).toBe(14);
  });

  it("refuses to load stock into a branch", async () => {
    await expect(
      loadDepositStock({ tenantId: tenant, depositId: branch._id, productId: product._id, quantity: 4 }),
    ).rejects.toMatchObject({ code: "TARGET_NOT_DEPOSIT" });
  });

  it("a sucursal user can sell and view stock but not manage the catalog or money", () => {
    expect(isSucursalAllowed("POST", "/api/orders")).toBe(true);
    expect(isSucursalAllowed("GET", "/api/products?page=1")).toBe(true);
    expect(isSucursalAllowed("GET", "/api/locations/abc/stock")).toBe(true);
    expect(isSucursalAllowed("POST", "/api/products")).toBe(false);
    expect(isSucursalAllowed("GET", "/api/financial/summary")).toBe(false);
    expect(isSucursalAllowed("POST", "/api/locations/transfers")).toBe(false);
  });
});
