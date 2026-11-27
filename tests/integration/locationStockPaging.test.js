/**
 * @fileoverview Paged place stock: search, pages and totals stay on the server for large catalogs.
 */

const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

const Location = require("../../src/models/location.model");
const LocationStock = require("../../src/models/locationStock.model");
const { Product } = require("../../src/models/product.model");
const { getLocationStock } = require("../../src/controllers/locationController");

let replSet;
const tenant = new mongoose.Types.ObjectId();
let deposit;

const call = async (query) => {
  const res = { statusCode: 200, body: undefined, status(code) { this.statusCode = code; return this; }, json(data) { this.body = data; return this; } };
  await getLocationStock({ user: { tenant, role: "admin" }, params: { id: String(deposit._id) }, query }, res);
  return res;
};

describe("place stock paging", () => {
  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    if (replSet) await replSet.stop();
  });

  beforeEach(async () => {
    await Promise.all([Location.deleteMany({}), LocationStock.deleteMany({}), Product.deleteMany({})]);
    deposit = await Location.create({ tenant, name: "Depósito central", kind: "deposito" });
    const products = Array.from({ length: 1005 }, (_, i) => ({
      tenant,
      name: `Producto ${String(i).padStart(4, "0")}`,
      stock: 2,
      price: 10,
      costPrice: 5,
    }));
    const created = await Product.insertMany(products);
    await LocationStock.insertMany(created.map((p) => ({ tenant, location: deposit._id, product: p._id, stock: 2 })));
  });

  it("returns the full list when no paging params are sent (transfer picker)", async () => {
    const res = await call({});
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(1005);
  });

  it("returns one page with totals for a large catalog", async () => {
    const res = await call({ page: "2", limit: "50" });
    expect(res.statusCode).toBe(200);
    expect(res.body.items).toHaveLength(50);
    expect(res.body.total).toBe(1005);
    expect(res.body.pages).toBe(21);
    expect(res.body.page).toBe(2);
    expect(res.body.totalProducts).toBe(1005);
    expect(res.body.totalUnits).toBe(2010);
    expect(res.body.items[0].name).toBe("Producto 0050");
  });

  it("searches by name across the whole place, not only the loaded page", async () => {
    const res = await call({ q: "producto 0999", limit: "50" });
    expect(res.body.total).toBe(1);
    expect(res.body.items[0].name).toBe("Producto 0999");
    expect(res.body.totalUnits).toBe(2010);
  });

  it("treats search text literally, not as a regex", async () => {
    const res = await call({ q: ".*", limit: "50" });
    expect(res.body.total).toBe(0);
  });

  it("caps the page size", async () => {
    const res = await call({ limit: "100000" });
    expect(res.body.items).toHaveLength(200);
  });
});
