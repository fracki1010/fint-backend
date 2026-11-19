/**
 * @fileoverview Runs the rotation aggregation against a real MongoDB so the
 * $unwind/$group pipeline and its date buckets are exercised, not just mocked.
 */

const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const Order = require("../../src/models/order.model");
const { Product } = require("../../src/models/product.model");
const { loadRotationFacts } = require("../../src/services/inventoryAnalyticsService");

let mongoServer;
const tenant = new mongoose.Types.ObjectId();
const client = new mongoose.Types.ObjectId();

const daysAgo = (days) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);

const order = (createdAt, items, salesStatus = "Confirmada") => ({
  tenant,
  client,
  createdAt,
  salesStatus,
  totalAmount: items.reduce((sum, item) => sum + item.price * item.quantity, 0),
  items,
});

describe("loadRotationFacts (MongoDB)", () => {
  let arroz;
  let yerba;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());

    arroz = await Product.create({ tenant, name: "Arroz", stock: 10, costPrice: 100 });
    yerba = await Product.create({ tenant, name: "Yerba", stock: 40, costPrice: 50 });

    const arrozLine = (quantity) => ({
      product: "Arroz",
      productId: arroz._id,
      quantity,
      price: 200,
      unitCostAtSale: 100,
    });

    await Order.insertMany([
      order(daysAgo(5), [arrozLine(4)]), // last 30 days
      order(daysAgo(20), [arrozLine(6)]), // last 30 days
      order(daysAgo(45), [arrozLine(5)]), // previous 30 days
      order(daysAgo(80), [arrozLine(15)]), // inside 90 days only
      order(daysAgo(10), [arrozLine(99)], "Cancelada"), // must be ignored
      order(daysAgo(200), [arrozLine(99)]), // outside the window
    ]);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    if (mongoServer) await mongoServer.stop();
  });

  it("buckets sold units into 30, 60 and 90 day windows and skips cancelled orders", async () => {
    const facts = await loadRotationFacts(tenant);
    const row = [...facts.fastestMovers, ...facts.idleStock].find((item) => item.name === "Arroz");

    expect(row.sold30).toBe(10); // 4 + 6
    expect(row.sold90).toBe(30); // 4 + 6 + 5 + 15
    expect(row.trendPct).toBe(Math.round(((10 - 5) / 5) * 100)); // prev30 = sold60 - sold30 = 5
    expect(row.rotation90).toBe(3); // 30 sold / 10 in stock
  });

  it("reports products with stock and no sales in 60 days as idle", async () => {
    const facts = await loadRotationFacts(tenant);
    const names = facts.idleStock.map((item) => item.name);

    expect(names).toContain("Yerba");
    expect(names).not.toContain("Arroz");
  });

  it("returns the revenue-based margin from the stored line costs", async () => {
    const facts = await loadRotationFacts(tenant);
    const row = facts.fastestMovers.find((item) => item.name === "Arroz");

    expect(row.marginPct).toBe(50); // (200 - 100) / 200
  });
});
