/**
 * @fileoverview Integration tests for Cash Closing API endpoints
 * Tests open, close, reopen, preview, Z-report, and list operations.
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
const CashClosing = require("../src/models/cashClosing.model");
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

describe("Cash Closing API", () => {
  let token;
  let tenantId;
  let closingId;

  beforeEach(async () => {
    token = await bootstrapAndGetToken();

    // Get tenant from created settings
    const settings = await Setting.findOne({});
    tenantId = settings.tenant;
  });

  describe("POST /api/cash-closing/open", () => {
    it("should open a cash closing", async () => {
      const response = await request(app)
        .post("/api/cash-closing/open")
        .set("Authorization", `Bearer ${token}`)
        .send({
          notes: "Test opening",
          initialCash: 1000,
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.status).toBe("open");
      expect(response.body.data.closingNumber).toMatch(/^CJ-/);
      expect(response.body.data.initialCash).toBe(1000);
      expect(response.body.data.notes).toBe("Test opening");
      expect(response.body.data.openedBy).toBeTruthy();
    });

    it("should not allow double open", async () => {
      // Open first
      await request(app)
        .post("/api/cash-closing/open")
        .set("Authorization", `Bearer ${token}`)
        .send({});

      // Try opening again
      const response = await request(app)
        .post("/api/cash-closing/open")
        .set("Authorization", `Bearer ${token}`)
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("OPEN_CLOSING_EXISTS");
    });

    it("should open with default values when no body provided", async () => {
      const response = await request(app)
        .post("/api/cash-closing/open")
        .set("Authorization", `Bearer ${token}`)
        .send({});

      expect(response.status).toBe(201);
      expect(response.body.data.initialCash).toBe(0);
      expect(response.body.data.notes).toBeNull();
    });

    it("should require authentication", async () => {
      const response = await request(app)
        .post("/api/cash-closing/open")
        .send({});

      expect(response.status).toBe(401);
    });
  });

  describe("GET /api/cash-closing/preview", () => {
    it("should preview expected totals with no orders", async () => {
      // Open first
      await request(app)
        .post("/api/cash-closing/open")
        .set("Authorization", `Bearer ${token}`)
        .send({});

      const response = await request(app)
        .get("/api/cash-closing/preview")
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeTruthy();
      expect(response.body.data.closing.status).toBe("open");
      expect(response.body.data.summary.totalOrders).toBe(0);
      expect(response.body.data.summary.totalSales).toBe(0);
    });

    it("should preview with orders after opening", async () => {
      // Open closing
      await request(app)
        .post("/api/cash-closing/open")
        .set("Authorization", `Bearer ${token}`)
        .send({});

      // Create a product
      const productRes = await request(app)
        .post("/api/products")
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "Test Product",
          price: 100,
          stock: 10,
        });
      expect(productRes.status).toBe(201);

      // Create a client
      const clientRes = await request(app)
        .post("/api/clients")
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "Test Client",
          phone: "5491111111111",
          taxId: "20-11111111-1",
        });
      expect(clientRes.status).toBe(201);

      // Create an order
      await request(app)
        .post("/api/orders")
        .set("Authorization", `Bearer ${token}`)
        .send({
          client: clientRes.body._id,
          items: [
            {
              product: "Test Product",
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
      expect(productRes.status).toBe(201);

      // Get preview — should see the order
      const previewRes = await request(app)
        .get("/api/cash-closing/preview")
        .set("Authorization", `Bearer ${token}`);

      expect(previewRes.status).toBe(200);
      expect(previewRes.body.data.summary.totalOrders).toBe(1);
      expect(previewRes.body.data.summary.totalSales).toBe(200);
    });

    it("should return null when no open closing exists", async () => {
      const response = await request(app)
        .get("/api/cash-closing/preview")
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.data).toBeNull();
    });
  });

  describe("POST /api/cash-closing/:id/close", () => {
    beforeEach(async () => {
      // Open a closing
      const openRes = await request(app)
        .post("/api/cash-closing/open")
        .set("Authorization", `Bearer ${token}`)
        .send({ initialCash: 500 });
      closingId = openRes.body.data._id;
    });

    it("should close with correct amounts", async () => {
      const response = await request(app)
        .post(`/api/cash-closing/${closingId}/close`)
        .set("Authorization", `Bearer ${token}`)
        .send({
          actualAmounts: {
            cash: 500,
            card: 0,
            transfer: 0,
            check: 0,
            other: 0,
          },
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.status).toBe("closed");
      expect(response.body.data.closedBy).toBeTruthy();
      expect(response.body.data.closedAt).toBeTruthy();
      expect(response.body.data.initialCash).toBe(500);
    });

    it("should detect discrepancy on close", async () => {
      // Create a paid order so we have expected amounts
      const productRes = await request(app)
        .post("/api/products")
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "Product With Cost",
          price: 200,
          stock: 10,
        });
      expect(productRes.status).toBe(201);

      const clientRes = await request(app)
        .post("/api/clients")
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "Client For Discrepancy",
          phone: "5491111111122",
          taxId: "20-22222222-2",
        });
      expect(clientRes.status).toBe(201);

      // Create paid order
      const orderRes = await request(app)
        .post("/api/orders")
        .set("Authorization", `Bearer ${token}`)
        .send({
          client: clientRes.body._id,
          items: [
            {
              product: "Product With Cost",
              productId: productRes.body._id,
              quantity: 1,
              price: 200,
            },
          ],
          totalAmount: 200,
          salesStatus: "Confirmada",
          paymentStatus: "Pagado",
          deliveryStatus: "Entregada",
        });
      expect(orderRes.status).toBe(201);

      // Close with amounts that don't match (expected 200 for order, we report cash=300)
      const response = await request(app)
        .post(`/api/cash-closing/${closingId}/close`)
        .set("Authorization", `Bearer ${token}`)
        .send({
          actualAmounts: {
            cash: 750,
            card: 0,
            transfer: 0,
            check: 0,
            other: 0,
          },
        });

      expect(response.status).toBe(200);
      // expectedTotal = 200 (order), actualTotal = 750 - 500 (initialCash) = 250
      // discrepancy = 250 - 200 = 50
      expect(response.body.data.discrepancyTotal).not.toBe(0);
      expect(response.body.data.expectedTotal).toBeGreaterThan(0);
    });

    it("should return 404 for non-existent closing", async () => {
      const fakeId = new mongoose.Types.ObjectId();
      const response = await request(app)
        .post(`/api/cash-closing/${fakeId}/close`)
        .set("Authorization", `Bearer ${token}`)
        .send({
          actualAmounts: { cash: 100 },
        });

      expect(response.status).toBe(404);
    });

    it("should return 400 when actualAmounts is missing", async () => {
      const response = await request(app)
        .post(`/api/cash-closing/${closingId}/close`)
        .set("Authorization", `Bearer ${token}`)
        .send({});

      expect(response.status).toBe(400);
    });
  });

  describe("POST /api/cash-closing/:id/reopen", () => {
    beforeEach(async () => {
      // Open and close a closing
      const openRes = await request(app)
        .post("/api/cash-closing/open")
        .set("Authorization", `Bearer ${token}`)
        .send({});
      closingId = openRes.body.data._id;

      await request(app)
        .post(`/api/cash-closing/${closingId}/close`)
        .set("Authorization", `Bearer ${token}`)
        .send({
          actualAmounts: { cash: 0 },
        });
    });

    it("should reopen a closed closing", async () => {
      const response = await request(app)
        .post(`/api/cash-closing/${closingId}/reopen`)
        .set("Authorization", `Bearer ${token}`)
        .send({
          reason: "Corrección de montos",
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.status).toBe("reopened");
      expect(response.body.data.reopenReason).toBe("Corrección de montos");
      expect(response.body.data.reopenedAt).toBeTruthy();
      expect(response.body.data.reopenedBy).toBeTruthy();
    });

    it("should return 400 when reason is too short", async () => {
      const response = await request(app)
        .post(`/api/cash-closing/${closingId}/reopen`)
        .set("Authorization", `Bearer ${token}`)
        .send({
          reason: "AB",
        });

      expect(response.status).toBe(400);
    });

    it("should return 400 when reason is missing", async () => {
      const response = await request(app)
        .post(`/api/cash-closing/${closingId}/reopen`)
        .set("Authorization", `Bearer ${token}`)
        .send({});

      expect(response.status).toBe(400);
    });

    it("should return 404 for non-existent closing", async () => {
      const fakeId = new mongoose.Types.ObjectId();
      const response = await request(app)
        .post(`/api/cash-closing/${fakeId}/reopen`)
        .set("Authorization", `Bearer ${token}`)
        .send({
          reason: "Test reason",
        });

      expect(response.status).toBe(404);
    });

    it("should return 404 when closing is not closed", async () => {
      // Open a new closing (not closed)
      const openRes = await request(app)
        .post("/api/cash-closing/open")
        .set("Authorization", `Bearer ${token}`)
        .send({});
      const newClosingId = openRes.body.data._id;

      const response = await request(app)
        .post(`/api/cash-closing/${newClosingId}/reopen`)
        .set("Authorization", `Bearer ${token}`)
        .send({
          reason: "Test reason",
        });

      expect(response.status).toBe(404);
    });
  });

  describe("GET /api/cash-closing", () => {
    it("should list closings with pagination", async () => {
      // Create multiple closings
      for (let i = 0; i < 3; i++) {
        const openRes = await request(app)
          .post("/api/cash-closing/open")
          .set("Authorization", `Bearer ${token}`)
          .send({});

        const closingId = openRes.body.data._id;

        await request(app)
          .post(`/api/cash-closing/${closingId}/close`)
          .set("Authorization", `Bearer ${token}`)
          .send({
            actualAmounts: { cash: 100 },
          });
      }

      const response = await request(app)
        .get("/api/cash-closing")
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(3);
      expect(response.body.pagination.total).toBe(3);
      expect(response.body.pagination.page).toBe(1);
    });

    it("should filter by status", async () => {
      // Create one open closing
      await request(app)
        .post("/api/cash-closing/open")
        .set("Authorization", `Bearer ${token}`)
        .send({});

      const response = await request(app)
        .get("/api/cash-closing?status=open")
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].status).toBe("open");
    });

    it("should apply pagination limits", async () => {
      // Create 3 closings
      for (let i = 0; i < 3; i++) {
        const openRes = await request(app)
          .post("/api/cash-closing/open")
          .set("Authorization", `Bearer ${token}`)
          .send({});

        const closingId = openRes.body.data._id;

        await request(app)
          .post(`/api/cash-closing/${closingId}/close`)
          .set("Authorization", `Bearer ${token}`)
          .send({
            actualAmounts: { cash: 100 },
          });
      }

      const response = await request(app)
        .get("/api/cash-closing?limit=2")
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(2);
    });
  });

  describe("GET /api/cash-closing/current", () => {
    it("should return the currently open closing", async () => {
      await request(app)
        .post("/api/cash-closing/open")
        .set("Authorization", `Bearer ${token}`)
        .send({});

      const response = await request(app)
        .get("/api/cash-closing/current")
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.status).toBe("open");
    });

    it("should return null when no open closing exists", async () => {
      const response = await request(app)
        .get("/api/cash-closing/current")
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.data).toBeNull();
    });
  });

  describe("GET /api/cash-closing/:id/report", () => {
    beforeEach(async () => {
      // Open and close a closing with orders
      const openRes = await request(app)
        .post("/api/cash-closing/open")
        .set("Authorization", `Bearer ${token}`)
        .send({});
      closingId = openRes.body.data._id;

      // Create product and client for orders
      const productRes = await request(app)
        .post("/api/products")
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "Report Product",
          price: 150,
          stock: 20,
        });
      expect(productRes.status).toBe(201);

      const clientRes = await request(app)
        .post("/api/clients")
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "Report Client",
          phone: "5491111111133",
          taxId: "20-33333333-3",
        });
      expect(clientRes.status).toBe(201);

      // Create an order after opening
      await request(app)
        .post("/api/orders")
        .set("Authorization", `Bearer ${token}`)
        .send({
          client: clientRes.body._id,
          items: [
            {
              product: "Report Product",
              productId: productRes.body._id,
              quantity: 1,
              price: 150,
            },
          ],
          totalAmount: 150,
          salesStatus: "Confirmada",
          paymentStatus: "Pagado",
          deliveryStatus: "Entregada",
        });

      // Close the closing
      const closeRes = await request(app)
        .post(`/api/cash-closing/${closingId}/close`)
        .set("Authorization", `Bearer ${token}`)
        .send({
          actualAmounts: {
            cash: 150,
            card: 0,
            transfer: 0,
            check: 0,
            other: 0,
          },
        });
      expect(closeRes.status).toBe(200);
    });

    it("should get Z-report for a closed closing", async () => {
      const response = await request(app)
        .get(`/api/cash-closing/${closingId}/report`)
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeTruthy();
      expect(response.body.data.closing).toBeTruthy();
      expect(response.body.data.orders).toBeDefined();
      expect(response.body.data.paymentBreakdown).toBeDefined();
      expect(response.body.data.hourlyBreakdown).toBeDefined();
      expect(response.body.data.summary).toBeDefined();
      expect(response.body.data.summary.totalOrders).toBe(1);
      expect(response.body.data.summary.totalSales).toBe(150);
    });

    it("should return 404 for non-existent closing", async () => {
      const fakeId = new mongoose.Types.ObjectId();
      const response = await request(app)
        .get(`/api/cash-closing/${fakeId}/report`)
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(404);
    });
  });

  describe("GET /api/cash-closing/:id", () => {
    beforeEach(async () => {
      const openRes = await request(app)
        .post("/api/cash-closing/open")
        .set("Authorization", `Bearer ${token}`)
        .send({});
      closingId = openRes.body.data._id;
    });

    it("should get a closing by ID", async () => {
      const response = await request(app)
        .get(`/api/cash-closing/${closingId}`)
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data._id).toBe(closingId);
      expect(response.body.data.status).toBe("open");
    });

    it("should return 404 for non-existent closing", async () => {
      const fakeId = new mongoose.Types.ObjectId();
      const response = await request(app)
        .get(`/api/cash-closing/${fakeId}`)
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(404);
    });
  });
});
