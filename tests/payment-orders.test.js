/**
 * @fileoverview Integration tests for Payment Orders API endpoints
 * Tests create, list, get by ID, apply, delete, and validation.
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

describe("Payment Orders API", () => {
  let token;
  let supplierId;
  let purchaseId;

  beforeEach(async () => {
    token = await bootstrapAndGetToken();

    // Create a supplier
    const supplierRes = await request(app)
      .post("/api/suppliers")
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: "Proveedor Test",
        company: "Test Corp",
        taxId: "30-12345678-9",
        phone: "5491111111111",
      });
    expect(supplierRes.status).toBe(201);
    supplierId = supplierRes.body._id;

    // Create a product for purchase items (need a supply or product)
    const productRes = await request(app)
      .post("/api/products")
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: "Insumo Compra",
        price: 500,
        stock: 100,
      });
    expect(productRes.status).toBe(201);
    const productId = productRes.body._id;

    // Create a purchase (CREDIT so it stays PENDING)
    const purchaseRes = await request(app)
      .post("/api/purchases")
      .set("Authorization", `Bearer ${token}`)
      .send({
        supplierId,
        date: "2026-05-01",
        paymentCondition: "CREDIT",
        subtotal: 500,
        tax: 0,
        total: 500,
        items: [
          {
            productItemId: productId,
            quantity: 1,
            unitCost: 500,
            lineTotal: 500,
          },
        ],
      });
    expect(purchaseRes.status).toBe(201);
    purchaseId = purchaseRes.body._id || purchaseRes.body.data?._id;

    // Confirm the purchase so it's valid for payment
    const confirmRes = await request(app)
      .post(`/api/purchases/${purchaseId}/confirm`)
      .set("Authorization", `Bearer ${token}`);
    expect(confirmRes.status === 200 || confirmRes.status === 201).toBe(true);
  });

  // ── Create Payment Order ─────────────────────────────────────────────

  describe("POST /api/payment-orders", () => {
    it("debería crear una orden de pago en estado DRAFT", async () => {
      const response = await request(app)
        .post("/api/payment-orders")
        .set("Authorization", `Bearer ${token}`)
        .send({
          supplierId,
          date: "2026-05-10",
          paymentMethod: "transfer",
          items: [{ purchaseId, amount: 500 }],
          total: 500,
        });

      expect(response.status).toBe(201);
      expect(response.body.status).toBe("DRAFT");
      expect(response.body.supplier).toBeTruthy();
      expect(response.body.total).toBe(500);
      expect(response.body.items).toHaveLength(1);
      expect(response.body.items[0].amount).toBe(500);
    });

    it("debería rechazar datos inválidos (sin items)", async () => {
      const response = await request(app)
        .post("/api/payment-orders")
        .set("Authorization", `Bearer ${token}`)
        .send({
          supplierId,
          date: "2026-05-10",
          total: 500,
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("debería rechazar sin autenticación", async () => {
      const response = await request(app)
        .post("/api/payment-orders")
        .send({
          supplierId,
          date: "2026-05-10",
          items: [{ purchaseId, amount: 500 }],
          total: 500,
        });

      expect(response.status).toBe(401);
    });
  });

  // ── List Payment Orders ──────────────────────────────────────────────

  describe("GET /api/payment-orders", () => {
    it("debería listar órdenes de pago vacío al inicio", async () => {
      const response = await request(app)
        .get("/api/payment-orders")
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body).toHaveLength(0);
    });

    it("debería listar órdenes de pago después de crear", async () => {
      await request(app)
        .post("/api/payment-orders")
        .set("Authorization", `Bearer ${token}`)
        .send({
          supplierId,
          date: "2026-05-10",
          items: [{ purchaseId, amount: 500 }],
          total: 500,
        });

      const response = await request(app)
        .get("/api/payment-orders")
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);
    });
  });

  // ── Get by ID ────────────────────────────────────────────────────────

  describe("GET /api/payment-orders/:id", () => {
    it("debería obtener una orden de pago por ID", async () => {
      const createRes = await request(app)
        .post("/api/payment-orders")
        .set("Authorization", `Bearer ${token}`)
        .send({
          supplierId,
          date: "2026-05-10",
          items: [{ purchaseId, amount: 500 }],
          total: 500,
        });
      expect(createRes.status).toBe(201);

      const response = await request(app)
        .get(`/api/payment-orders/${createRes.body._id}`)
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body._id).toBe(createRes.body._id);
      expect(response.body.items).toHaveLength(1);
      expect(response.body.items[0].purchase).toBeTruthy();
    });

    it("debería devolver 404 para ID inexistente", async () => {
      const fakeId = new mongoose.Types.ObjectId();
      const response = await request(app)
        .get(`/api/payment-orders/${fakeId}`)
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(404);
    });
  });

  // ── Apply Payment Order ──────────────────────────────────────────────

  describe("POST /api/payment-orders/:id/apply", () => {
    it("debería aplicar una orden de pago y marcarla como PAID", async () => {
      const createRes = await request(app)
        .post("/api/payment-orders")
        .set("Authorization", `Bearer ${token}`)
        .send({
          supplierId,
          date: "2026-05-10",
          items: [{ purchaseId, amount: 500 }],
          total: 500,
        });
      expect(createRes.status).toBe(201);
      expect(createRes.body.status).toBe("DRAFT");

      const response = await request(app)
        .post(`/api/payment-orders/${createRes.body._id}/apply`)
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.status).toBe("PAID");
      expect(response.body.paidAt).toBeTruthy();
    });

    it("debería devolver 404 al aplicar una orden inexistente", async () => {
      const fakeId = new mongoose.Types.ObjectId();
      const response = await request(app)
        .post(`/api/payment-orders/${fakeId}/apply`)
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(404);
    });

    it("debería devolver 409 al aplicar una orden ya PAID", async () => {
      const createRes = await request(app)
        .post("/api/payment-orders")
        .set("Authorization", `Bearer ${token}`)
        .send({
          supplierId,
          date: "2026-05-10",
          items: [{ purchaseId, amount: 500 }],
          total: 500,
        });

      // Apply first time
      await request(app)
        .post(`/api/payment-orders/${createRes.body._id}/apply`)
        .set("Authorization", `Bearer ${token}`);

      // Apply second time should fail
      const response = await request(app)
        .post(`/api/payment-orders/${createRes.body._id}/apply`)
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe("INVALID_STATUS_TRANSITION");
    });
  });

  // ── Delete Payment Order ─────────────────────────────────────────────

  describe("DELETE /api/payment-orders/:id", () => {
    it("debería eliminar una orden de pago en estado DRAFT", async () => {
      const createRes = await request(app)
        .post("/api/payment-orders")
        .set("Authorization", `Bearer ${token}`)
        .send({
          supplierId,
          date: "2026-05-10",
          items: [{ purchaseId, amount: 500 }],
          total: 500,
        });
      expect(createRes.status).toBe(201);

      const deleteRes = await request(app)
        .delete(`/api/payment-orders/${createRes.body._id}`)
        .set("Authorization", `Bearer ${token}`);

      expect(deleteRes.status).toBe(200);

      // Verify it's gone
      const getRes = await request(app)
        .get(`/api/payment-orders/${createRes.body._id}`)
        .set("Authorization", `Bearer ${token}`);
      expect(getRes.status).toBe(404);
    });

    it("debería devolver 409 al eliminar una orden PAID", async () => {
      const createRes = await request(app)
        .post("/api/payment-orders")
        .set("Authorization", `Bearer ${token}`)
        .send({
          supplierId,
          date: "2026-05-10",
          items: [{ purchaseId, amount: 500 }],
          total: 500,
        });

      // Apply first
      await request(app)
        .post(`/api/payment-orders/${createRes.body._id}/apply`)
        .set("Authorization", `Bearer ${token}`);

      // Try to delete after PAID
      const deleteRes = await request(app)
        .delete(`/api/payment-orders/${createRes.body._id}`)
        .set("Authorization", `Bearer ${token}`);

      expect(deleteRes.status).toBe(409);
      expect(deleteRes.body.error.code).toBe("PAYMENT_ORDER_NOT_DELETABLE");
    });
  });
});
