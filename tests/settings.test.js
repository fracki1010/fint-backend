/**
 * @fileoverview Integration tests for Settings API endpoints
 * Tests get, update, and field-specific updates.
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
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

describe("Settings API", () => {
  let token;

  beforeEach(async () => {
    token = await bootstrapAndGetToken();
  });

  describe("GET /api/settings", () => {
    it("should get settings → 200, returns current settings with defaults", async () => {
      const response = await request(app)
        .get("/api/settings")
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);
      // Bootstrap sets storeName in the payload
      expect(response.body.storeName).toBe("Test Store");
      // Defaults from the model
      expect(response.body.taxRate).toBe(0);
      expect(response.body.currency).toBe("USD");
      expect(response.body.theme).toBe("light");
      expect(response.body.lowStockThreshold).toBe(5);
      expect(response.body.orderPrefix).toBe("VTA");
      expect(response.body.whatsappEnabled).toBe(true);
      expect(response.body.tenant).toBeTruthy();
      expect(response.body.admin).toBeTruthy();
      expect(response.body.admin.fullName).toBe("Test Admin");
    });

    it("should require authentication", async () => {
      const response = await request(app)
        .get("/api/settings");

      expect(response.status).toBe(401);
    });
  });

  describe("PUT /api/settings", () => {
    it("should update settings → 200, fields updated", async () => {
      const response = await request(app)
        .put("/api/settings")
        .set("Authorization", `Bearer ${token}`)
        .send({
          storeName: "Updated Store",
          taxRate: 21,
          currency: "ARS",
          lowStockThreshold: 10,
        });

      expect(response.status).toBe(200);
      expect(response.body.storeName).toBe("Updated Store");
      expect(response.body.taxRate).toBe(21);
      expect(response.body.currency).toBe("ARS");
      expect(response.body.lowStockThreshold).toBe(10);
    });

    it("should update specific institutional fields", async () => {
      const response = await request(app)
        .put("/api/settings")
        .set("Authorization", `Bearer ${token}`)
        .send({
          storeName: "My Business",
          taxId: "30-12345678-9",
          fiscalCondition: "Responsable Inscripto",
          address: "Av. Siempre Viva 123",
          phone: "5491112345678",
          email: "store@example.com",
          invoiceTerms: "30 días",
        });

      expect(response.status).toBe(200);
      expect(response.body.storeName).toBe("My Business");
      expect(response.body.taxId).toBe("30-12345678-9");
      expect(response.body.fiscalCondition).toBe("Responsable Inscripto");
      expect(response.body.address).toBe("Av. Siempre Viva 123");
      expect(response.body.phone).toBe("5491112345678");
      expect(response.body.email).toBe("store@example.com");
      expect(response.body.invoiceTerms).toBe("30 días");
    });

    it("should update operational preferences", async () => {
      const response = await request(app)
        .put("/api/settings")
        .set("Authorization", `Bearer ${token}`)
        .send({
          orderPrefix: "ORD",
          theme: "dark",
          stockDeductionMoment: "confirmation",
          allowDeliveryWithoutPayment: true,
        });

      expect(response.status).toBe(200);
      expect(response.body.orderPrefix).toBe("ORD");
      expect(response.body.theme).toBe("dark");
      expect(response.body.stockDeductionMoment).toBe("confirmation");
      expect(response.body.allowDeliveryWithoutPayment).toBe(true);
    });

    it("should update WhatsApp settings", async () => {
      const response = await request(app)
        .put("/api/settings")
        .set("Authorization", `Bearer ${token}`)
        .send({
          whatsappEnabled: false,
          whatsappNumberFormat: "INTL",
          whatsappAdminNumber: "541112345678",
        });

      expect(response.status).toBe(200);
      expect(response.body.whatsappEnabled).toBe(false);
      expect(response.body.whatsappNumberFormat).toBe("INTL");
      // Should normalize to AR format if format=AR, but we set INTL so it stays as-is
    });

    it("should get settings after update → reflects changes", async () => {
      // Update
      await request(app)
        .put("/api/settings")
        .set("Authorization", `Bearer ${token}`)
        .send({
          storeName: "Changed Store",
          taxRate: 10.5,
        });

      // Get and verify
      const response = await request(app)
        .get("/api/settings")
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.storeName).toBe("Changed Store");
      expect(response.body.taxRate).toBe(10.5);
    });

    it("should reject tax rate over 100 via validator", async () => {
      const response = await request(app)
        .put("/api/settings")
        .set("Authorization", `Bearer ${token}`)
        .send({ taxRate: 150 });

      // The zod validator rejects values > 100 before the controller clamps them
      expect(response.status).toBe(400);
      expect(response.body.error).toBeTruthy();
    });

    it("should require authentication", async () => {
      const response = await request(app)
        .put("/api/settings")
        .send({ storeName: "No Auth" });

      expect(response.status).toBe(401);
    });
  });
});
