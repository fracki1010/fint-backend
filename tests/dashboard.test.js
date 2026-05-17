/**
 * @fileoverview Integration tests for Dashboard API endpoints
 * Tests summary, daily sales, optional KPIs, and data reflection.
 */

const mongoose = require("mongoose");
const request = require("supertest");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test_jwt_secret_123";
process.env.ADMIN_SETUP_KEY = "test_setup_key_123";
process.env.AUTH_BOOTSTRAP_ENABLED = "true";
process.env.CORS_ORIGINS = "http://localhost:5173";

const { createApp } = require("../src/app");
const Setting = require("../src/models/setting.model");
const Tenant = require("../src/models/tenant.model");

let mongoServer;
let app;
let bootstrapCounter = 0;

const bootstrapPayload = {
  setupKey: process.env.ADMIN_SETUP_KEY,
  fullName: "Test Admin",
  email: "admin@test.local",
  password: "secret123",
  storeName: "Test Store",
};

async function bootstrapAndGetToken() {
  bootstrapCounter += 1;
  const testIp = `127.0.0.${Math.min(bootstrapCounter, 250)}`;

  const bootstrapResponse = await request(app)
    .post("/api/auth/bootstrap-superadmin")
    .set("X-Forwarded-For", testIp)
    .send(bootstrapPayload);

  expect(bootstrapResponse.status).toBe(201);
  expect(bootstrapResponse.body.token).toBeTruthy();

  // Enable features for testing
  const settings = await Setting.findOne({});
  await Tenant.findByIdAndUpdate(settings.tenant, {
    plan: "business",
    enabledFeatures: [
      "client_account",
      "supplier_account",
      "quotes",
      "financial_center",
      "recipes",
      "bill_of_materials",
      "team_management",
      "unlimited_products",
      "unlimited_orders",
      "banking",
    ],
  });

  return bootstrapResponse.body.token;
}

beforeAll(async () => {
  mongoServer = await MongoMemoryReplSet.create({
    replSet: { count: 1 },
  });
  const uri = mongoServer.getUri();
  await mongoose.connect(uri);
  app = createApp({ allowedOrigins: ["http://localhost:5173"] });
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

describe("Dashboard API", () => {
  let token;

  beforeEach(async () => {
    token = await bootstrapAndGetToken();
  });

  describe("GET /api/dashboard/summary", () => {
    it("should get dashboard stats → 200, has expected keys", async () => {
      const response = await request(app)
        .get("/api/dashboard/summary")
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("generatedAt");
      expect(response.body).toHaveProperty("sales");
      expect(response.body.sales).toHaveProperty("todaySales");
      expect(response.body.sales).toHaveProperty("monthSales");
      expect(response.body.sales).toHaveProperty("collectedMonth");
      expect(response.body.sales).toHaveProperty("averageTicket");
      expect(response.body.sales).toHaveProperty("totalOrdersMonth");
      expect(response.body).toHaveProperty("universalKpis");
      expect(response.body.universalKpis).toHaveProperty("salesNet");
      expect(response.body.universalKpis).toHaveProperty("grossProfit");
      expect(response.body.universalKpis).toHaveProperty("grossMarginPct");
      expect(response.body.universalKpis).toHaveProperty("averageTicket");
      expect(response.body.universalKpis).toHaveProperty("growth");
      expect(response.body.universalKpis).toHaveProperty("customers");
      expect(response.body).toHaveProperty("operations");
      expect(response.body.operations).toHaveProperty("totalOrders");
      expect(response.body).toHaveProperty("inventory");
      expect(response.body.inventory).toHaveProperty("totalProducts");
      expect(response.body.inventory).toHaveProperty("lowStockCount");
      expect(response.body.inventory).toHaveProperty("stockValue");
      expect(response.body).toHaveProperty("customers");
      expect(response.body.customers).toHaveProperty("totalClients");
      expect(response.body.customers).toHaveProperty("activeClients");
      expect(response.body).toHaveProperty("topProducts");
      expect(response.body).toHaveProperty("recentOrders");
      expect(response.body).toHaveProperty("recentMovements");
      expect(response.body).toHaveProperty("purchasing");
    });

    it("should return zero values when there is no data", async () => {
      const response = await request(app)
        .get("/api/dashboard/summary")
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.sales.todaySales).toBe(0);
      expect(response.body.sales.monthSales).toBe(0);
      expect(response.body.customers.totalClients).toBe(0);
      expect(response.body.customers.activeClients).toBe(0);
      expect(response.body.inventory.totalProducts).toBe(0);
      expect(response.body.operations.totalOrders).toBe(0);
      expect(response.body.topProducts).toEqual([]);
      expect(response.body.recentOrders).toEqual([]);
    });

    it("should reflect created data in dashboard", async () => {
      // Create a product
      const productRes = await request(app)
        .post("/api/products")
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "Dashboard Product",
          price: 100,
          stock: 10,
        });
      expect(productRes.status).toBe(201);

      // Create a client
      const clientRes = await request(app)
        .post("/api/clients")
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "Dashboard Client",
          phone: "5491111111111",
          taxId: "20-11111111-1",
        });
      expect(clientRes.status).toBe(201);

      // Create an order
      const orderRes = await request(app)
        .post("/api/orders")
        .set("Authorization", `Bearer ${token}`)
        .send({
          client: clientRes.body._id,
          items: [
            {
              product: "Dashboard Product",
              productId: productRes.body._id,
              quantity: 2,
              price: 100,
            },
          ],
          totalAmount: 200,
          salesStatus: "Confirmada",
          paymentStatus: "Pagado",
          deliveryStatus: "Entregada",
        });
      expect(orderRes.status).toBe(201);

      // Fetch dashboard and verify data is reflected
      const response = await request(app)
        .get("/api/dashboard/summary")
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.inventory.totalProducts).toBe(1);
      expect(response.body.customers.totalClients).toBe(1);
      expect(response.body.customers.activeClients).toBe(1);
      expect(response.body.operations.totalOrders).toBe(1);
      expect(response.body.sales.todaySales).toBe(200);
      expect(response.body.sales.monthSales).toBe(200);
      expect(response.body.topProducts.length).toBeGreaterThanOrEqual(1);
    });

    it("should require authentication", async () => {
      const response = await request(app)
        .get("/api/dashboard/summary");

      expect(response.status).toBe(401);
    });
  });

  describe("GET /api/dashboard/daily-sales", () => {
    it("should get daily sales → 200", async () => {
      const response = await request(app)
        .get("/api/dashboard/daily-sales")
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.sales)).toBe(true);
      expect(response.body.days).toBe(14);
    });

    it("should return sales data with zeroes when no orders", async () => {
      const response = await request(app)
        .get("/api/dashboard/daily-sales?days=7")
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.days).toBe(7);
      expect(response.body.sales).toHaveLength(7);
      response.body.sales.forEach((day) => {
        expect(day.revenue).toBe(0);
        expect(day.orders).toBe(0);
      });
    });

    it("should require authentication", async () => {
      const response = await request(app)
        .get("/api/dashboard/daily-sales");

      expect(response.status).toBe(401);
    });
  });

  describe("GET /api/dashboard/optional-kpis", () => {
    it("should get optional KPIs → 200", async () => {
      const response = await request(app)
        .get("/api/dashboard/optional-kpis")
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("generatedAt");
      expect(response.body).toHaveProperty("meta");
      expect(response.body.meta).toHaveProperty("startDate");
      expect(response.body.meta).toHaveProperty("endDate");
      expect(response.body.meta).toHaveProperty("periodDays");
      expect(response.body).toHaveProperty("inventoryRotation");
      expect(response.body).toHaveProperty("salesByCategory");
      expect(response.body).toHaveProperty("salesByHour");
      expect(response.body).toHaveProperty("salesByWeekday");
      expect(response.body).toHaveProperty("topProductsByVolume");
      expect(response.body).toHaveProperty("topProductsByMargin");
      expect(response.body).toHaveProperty("topClients");
    });
  });

  describe("POST /api/dashboard/snapshots/capture", () => {
    it("should capture inventory snapshot → 201", async () => {
      const response = await request(app)
        .post("/api/dashboard/snapshots/capture")
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(201);
      expect(response.body.snapshot).toBeTruthy();
      expect(response.body.snapshot.date).toBeTruthy();
    });

    it("should require authentication", async () => {
      const response = await request(app)
        .post("/api/dashboard/snapshots/capture");

      expect(response.status).toBe(401);
    });
  });
});
