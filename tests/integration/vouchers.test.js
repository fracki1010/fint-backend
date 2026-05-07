/**
 * @fileoverview Integration tests for Voucher API endpoints
 * Tests POST /orders/:id/vouchers, GET /vouchers, download, and void operations.
 */

const mongoose = require("mongoose");
const request = require("supertest");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const fs = require("fs");
const path = require("path");

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test_jwt_secret_123";
process.env.ADMIN_SETUP_KEY = "test_setup_key_123";
process.env.AUTH_BOOTSTRAP_ENABLED = "true";
process.env.CORS_ORIGINS = "http://localhost:5173";

const { createApp } = require("../../src/app");
const Voucher = require("../../src/models/voucher.model");
const VoucherCounter = require("../../src/models/voucherCounter.model");
const Order = require("../../src/models/order.model");
const Client = require("../../src/models/client.model");
const Setting = require("../../src/models/setting.model");

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

  // Clean up test PDFs
  const testPdfDir = path.join(process.cwd(), "comprobantes");
  if (fs.existsSync(testPdfDir)) {
    fs.rmSync(testPdfDir, { recursive: true, force: true });
  }
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

describe("Voucher API Integration", () => {
  let token;
  let tenantId;
  let clientId;
  let orderId;

  beforeEach(async () => {
    token = await bootstrapAndGetToken();

    // Get tenant from created settings
    const settings = await Setting.findOne({});
    tenantId = settings.tenant;

    // Create test client
    const clientResponse = await request(app)
      .post("/api/clients")
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: "Test Client",
        phone: "5491111111111",
        taxId: "20-11111111-1",
      });
    expect(clientResponse.status).toBe(201);
    clientId = clientResponse.body._id;

    // Create test order
    const productResponse = await request(app)
      .post("/api/products")
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: "Test Product",
        price: 100,
        stock: 10,
      });
    expect(productResponse.status).toBe(201);

    const orderResponse = await request(app)
      .post("/api/orders")
      .set("Authorization", `Bearer ${token}`)
      .send({
        client: clientId,
        items: [
          {
            product: "Test Product",
            productId: productResponse.body._id,
            quantity: 2,
            price: 100,
          },
        ],
        totalAmount: 200,
        salesStatus: "Confirmada",
        paymentStatus: "Pagado",
        deliveryStatus: "Entregada",
      });
    expect(orderResponse.status).toBe(201);
    orderId = orderResponse.body._id;
  });

  describe("POST /orders/:id/vouchers", () => {
    it("should create single voucher", async () => {
      const response = await request(app)
        .post(`/api/orders/${orderId}/vouchers`)
        .set("Authorization", `Bearer ${token}`)
        .send({
          types: ["invoice"],
        });

      expect(response.status).toBe(201);
      expect(response.body.vouchers).toHaveLength(1);
      expect(response.body.vouchers[0].type).toBe("invoice");
      expect(response.body.vouchers[0].number).toMatch(/^F-/);
      expect(response.body.totalGenerated).toBe(1);
    });

    it("should create multiple vouchers in batch", async () => {
      const response = await request(app)
        .post(`/api/orders/${orderId}/vouchers`)
        .set("Authorization", `Bearer ${token}`)
        .send({
          types: ["invoice", "delivery_note", "receipt"],
        });

      expect(response.status).toBe(201);
      expect(response.body.vouchers).toHaveLength(3);
      expect(response.body.totalGenerated).toBe(3);

      // Verify all types
      const types = response.body.vouchers.map((v) => v.type).sort();
      expect(types).toEqual(["delivery_note", "invoice", "receipt"]);
    });

    it("should return 400 for invalid voucher types", async () => {
      const response = await request(app)
        .post(`/api/orders/${orderId}/vouchers`)
        .set("Authorization", `Bearer ${token}`)
        .send({
          types: ["invalid_type"],
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("INVALID_VOUCHER_TYPES");
    });

    it("should return 400 for empty types array", async () => {
      const response = await request(app)
        .post(`/api/orders/${orderId}/vouchers`)
        .set("Authorization", `Bearer ${token}`)
        .send({
          types: [],
        });

      expect(response.status).toBe(400);
    });

    it("should return 404 for non-existent order", async () => {
      const fakeId = new mongoose.Types.ObjectId();
      const response = await request(app)
        .post(`/api/orders/${fakeId}/vouchers`)
        .set("Authorization", `Bearer ${token}`)
        .send({
          types: ["invoice"],
        });

      expect(response.status).toBe(404);
    });

    it("should require authentication", async () => {
      const response = await request(app)
        .post(`/api/orders/${orderId}/vouchers`)
        .send({
          types: ["invoice"],
        });

      expect(response.status).toBe(401);
    });
  });

  describe("GET /orders/:id/vouchers", () => {
    beforeEach(async () => {
      // Create some vouchers
      await request(app)
        .post(`/api/orders/${orderId}/vouchers`)
        .set("Authorization", `Bearer ${token}`)
        .send({
          types: ["invoice", "receipt"],
        });
    });

    it("should list vouchers for order", async () => {
      const response = await request(app)
        .get(`/api/orders/${orderId}/vouchers`)
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.vouchers).toHaveLength(2);
    });

    it("should exclude voided vouchers by default", async () => {
      // Get first voucher and void it
      const vouchers = await Voucher.find({ order: orderId });
      await request(app)
        .post(`/api/vouchers/${vouchers[0]._id}/void`)
        .set("Authorization", `Bearer ${token}`)
        .send({ reason: "Test void" });

      const response = await request(app)
        .get(`/api/orders/${orderId}/vouchers`)
        .set("Authorization", `Bearer ${token}`);

      expect(response.body.vouchers).toHaveLength(1);
    });

    it("should include voided vouchers with includeVoided=true", async () => {
      const vouchers = await Voucher.find({ order: orderId });
      await request(app)
        .post(`/api/vouchers/${vouchers[0]._id}/void`)
        .set("Authorization", `Bearer ${token}`)
        .send({ reason: "Test void" });

      const response = await request(app)
        .get(`/api/orders/${orderId}/vouchers?includeVoided=true`)
        .set("Authorization", `Bearer ${token}`);

      expect(response.body.vouchers).toHaveLength(2);
    });
  });

  describe("GET /vouchers/:id/download", () => {
    let voucherId;

    beforeEach(async () => {
      const response = await request(app)
        .post(`/api/orders/${orderId}/vouchers`)
        .set("Authorization", `Bearer ${token}`)
        .send({
          types: ["invoice"],
        });

      voucherId = response.body.vouchers[0]._id;
    });

    it("should download voucher PDF", async () => {
      const response = await request(app)
        .get(`/api/vouchers/${voucherId}/download`)
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.headers["content-type"]).toBe("application/pdf");
      expect(response.headers["content-disposition"]).toContain("attachment");
    });

    it("should return 404 for non-existent voucher", async () => {
      const fakeId = new mongoose.Types.ObjectId();
      const response = await request(app)
        .get(`/api/vouchers/${fakeId}/download`)
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(404);
    });

    it("should require authentication", async () => {
      const response = await request(app)
        .get(`/api/vouchers/${voucherId}/download`);

      expect(response.status).toBe(401);
    });
  });

  describe("POST /vouchers/:id/void", () => {
    let voucherId;
    let voucherNumber;

    beforeEach(async () => {
      const response = await request(app)
        .post(`/api/orders/${orderId}/vouchers`)
        .set("Authorization", `Bearer ${token}`)
        .send({
          types: ["invoice"],
        });

      voucherId = response.body.vouchers[0]._id;
      voucherNumber = response.body.vouchers[0].number;
    });

    it("should void voucher with reason", async () => {
      const response = await request(app)
        .post(`/api/vouchers/${voucherId}/void`)
        .set("Authorization", `Bearer ${token}`)
        .send({
          reason: "Error en datos del cliente",
        });

      expect(response.status).toBe(200);
      expect(response.body.voucher.status).toBe("voided");
      expect(response.body.voucher.voidReason).toBe("Error en datos del cliente");
      expect(response.body.message).toContain("anulado");
    });

    it("should return 400 when reason is missing", async () => {
      const response = await request(app)
        .post(`/api/vouchers/${voucherId}/void`)
        .set("Authorization", `Bearer ${token}`)
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("VOID_REASON_REQUIRED");
    });

    it("should return 400 when reason is too short", async () => {
      const response = await request(app)
        .post(`/api/vouchers/${voucherId}/void`)
        .set("Authorization", `Bearer ${token}`)
        .send({
          reason: "AB",
        });

      expect(response.status).toBe(400);
    });

    it("should return 404 for non-existent voucher", async () => {
      const fakeId = new mongoose.Types.ObjectId();
      const response = await request(app)
        .post(`/api/vouchers/${fakeId}/void`)
        .set("Authorization", `Bearer ${token}`)
        .send({
          reason: "Test reason",
        });

      expect(response.status).toBe(404);
    });

    it("should return 400 when voucher already voided", async () => {
      // Void first time
      await request(app)
        .post(`/api/vouchers/${voucherId}/void`)
        .set("Authorization", `Bearer ${token}`)
        .send({
          reason: "First void",
        });

      // Try to void again
      const response = await request(app)
        .post(`/api/vouchers/${voucherId}/void`)
        .set("Authorization", `Bearer ${token}`)
        .send({
          reason: "Second void",
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("ALREADY_VOIDED");
    });
  });

  describe("GET /vouchers", () => {
    beforeEach(async () => {
      // Create multiple vouchers across different orders
      const productResponse = await request(app)
        .post("/api/products")
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "Another Product",
          price: 50,
          stock: 20,
        });

      const order2Response = await request(app)
        .post("/api/orders")
        .set("Authorization", `Bearer ${token}`)
        .send({
          client: clientId,
          items: [
            {
              product: "Another Product",
              productId: productResponse.body._id,
              quantity: 1,
              price: 50,
            },
          ],
          totalAmount: 50,
        });

      // Create vouchers for both orders
      await request(app)
        .post(`/api/orders/${orderId}/vouchers`)
        .set("Authorization", `Bearer ${token}`)
        .send({ types: ["invoice", "delivery_note"] });

      await request(app)
        .post(`/api/orders/${order2Response.body._id}/vouchers`)
        .set("Authorization", `Bearer ${token}`)
        .send({ types: ["invoice"] });
    });

    it("should list all vouchers with pagination", async () => {
      const response = await request(app)
        .get("/api/vouchers")
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.vouchers).toHaveLength(3);
      expect(response.body.total).toBe(3);
      expect(response.body.page).toBe(1);
    });

    it("should filter by type", async () => {
      const response = await request(app)
        .get("/api/vouchers?type=invoice")
        .set("Authorization", `Bearer ${token}`);

      expect(response.body.vouchers).toHaveLength(2);
      expect(response.body.vouchers.every((v) => v.type === "invoice")).toBe(true);
    });

    it("should filter by status", async () => {
      // Void one voucher
      const voucher = await Voucher.findOne({ type: "invoice" });
      await request(app)
        .post(`/api/vouchers/${voucher._id}/void`)
        .set("Authorization", `Bearer ${token}`)
        .send({ reason: "Test" });

      const response = await request(app)
        .get("/api/vouchers?status=voided")
        .set("Authorization", `Bearer ${token}`);

      expect(response.body.vouchers).toHaveLength(1);
      expect(response.body.vouchers[0].status).toBe("voided");
    });

    it("should apply pagination limits", async () => {
      const response = await request(app)
        .get("/api/vouchers?limit=2")
        .set("Authorization", `Bearer ${token}`);

      expect(response.body.vouchers).toHaveLength(2);
      expect(response.body.hasNextPage).toBe(true);
    });
  });

  describe("Concurrent generation stress test", () => {
    it("should handle 50 concurrent batch generations without duplicates", async () => {
      const promises = [];
      for (let i = 0; i < 50; i++) {
        promises.push(
          request(app)
            .post(`/api/orders/${orderId}/vouchers`)
            .set("Authorization", `Bearer ${token}`)
            .send({ types: ["invoice"] })
        );
      }

      const responses = await Promise.all(promises);

      // Check all successful requests
      const successful = responses.filter((r) => r.status === 201);

      // Get all generated voucher numbers
      const allVouchers = await Voucher.find({ order: orderId, type: "invoice" });
      const numbers = allVouchers.map((v) => v.sequentialNumber);
      const uniqueNumbers = new Set(numbers);

      // All numbers should be unique
      expect(uniqueNumbers.size).toBe(numbers.length);

      // Counter should reflect total generated
      const counter = await VoucherCounter.findOne({
        tenant: tenantId,
        type: "invoice",
      });
      expect(counter.lastNumber).toBe(numbers.length);
    });
  });

  describe("Year reset functionality", () => {
    it("should reset counter on year change when annual reset enabled", async () => {
      // Create counter for previous year with high number
      const previousYear = new Date().getFullYear() - 1;
      await VoucherCounter.create({
        tenant: tenantId,
        type: "invoice",
        year: previousYear,
        prefix: "F-",
        lastNumber: 999,
      });

      // Generate voucher for current year
      const response = await request(app)
        .post(`/api/orders/${orderId}/vouchers`)
        .set("Authorization", `Bearer ${token}`)
        .send({ types: ["invoice"] });

      expect(response.status).toBe(201);

      // Should start from 1 (or low number) for new year
      const voucher = response.body.vouchers[0];
      expect(voucher.sequentialNumber).toBeLessThan(100);
    });
  });
});
