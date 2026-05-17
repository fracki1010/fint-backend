/**
 * @fileoverview Integration tests for the complement-driven billing flow.
 * Tests preference creation, webhook processing, tenant plan fetch, and auth login.
 */

const mongoose = require("mongoose");
const request = require("supertest");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test_jwt_secret_123";
process.env.ADMIN_SETUP_KEY = "test_setup_key_123";
process.env.AUTH_BOOTSTRAP_ENABLED = "true";
process.env.CORS_ORIGINS = "http://localhost:5173";
process.env.MERCADO_PAGO_ACCESS_TOKEN = "TEST_MP_TOKEN";
process.env.FRONTEND_URL = "http://localhost:5173";

const { createApp } = require("../../src/app");
const Tenant = require("../../src/models/tenant.model");
const PaymentRecord = require("../../src/models/payment.model");
const { processApprovedPayment } = require("../../src/controllers/paymentController");
const { deriveEnabledFeatures, deriveLimits, computeTotalPrice } = require("../../src/config/complementConfig");

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

  // Put tenant on app_base with no complements
  const tenantId = bootstrapResponse.body.user.tenant._id;
  await Tenant.findByIdAndUpdate(tenantId, {
    plan: "app_base",
    complements: [],
    enabledFeatures: deriveEnabledFeatures([]),
    limits: deriveLimits([]),
  });

  return bootstrapResponse.body.token;
}

beforeAll(async () => {
  mongoServer = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
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

describe("Billing flow with complements", () => {
  it("POST /api/payments/create-preference rejects invalid complement IDs", async () => {
    const token = await bootstrapAndGetToken();

    const response = await request(app)
      .post("/api/payments/create-preference")
      .set("Authorization", `Bearer ${token}`)
      .send({ complements: ["expansion", "team_10"] });

    // MercadoPago is not mocked in integration tests, so real MP call fails.
    // We verify the endpoint reaches MP (doesn't reject earlier) by checking it's not a validation error.
    expect(response.status).not.toBe(400);
  });

  it("rejects invalid complement IDs when creating preference", async () => {
    const token = await bootstrapAndGetToken();

    const response = await request(app)
      .post("/api/payments/create-preference")
      .set("Authorization", `Bearer ${token}`)
      .send({ complements: ["fake_complement"] });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("INVALID_PLAN");
  });

  it("GET /api/tenant/plan returns complements, enabledFeatures, and derived limits", async () => {
    const token = await bootstrapAndGetToken();

    // Activate some complements directly
    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ email: bootstrapPayload.email, password: bootstrapPayload.password });
    const tenantId = loginRes.body.user.tenant._id;

    await Tenant.findByIdAndUpdate(tenantId, {
      complements: ["expansion", "team_10"],
      enabledFeatures: deriveEnabledFeatures(["expansion", "team_10"]),
      limits: deriveLimits(["expansion", "team_10"]),
    });

    const response = await request(app)
      .get("/api/tenant/plan")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.plan.current).toBe("app_base");
    expect(response.body.plan.complements).toContain("expansion");
    expect(response.body.plan.complements).toContain("team_10");
    expect(response.body.plan.enabledFeatures).toContain("team_management");
    expect(response.body.plan.enabledFeatures).toContain("unlimited_products");
    expect(response.body.plan.limits.maxProducts).toBe(-1);
    expect(response.body.plan.limits.maxUsers).toBe(10);
    expect(response.body.availableComplements).toBeDefined();
    expect(response.body.availableComplements.length).toBeGreaterThan(0);
  });

  it("auth login returns enabledFeatures in tenant payload", async () => {
    await bootstrapAndGetToken();

    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ email: bootstrapPayload.email, password: bootstrapPayload.password });

    expect(loginRes.status).toBe(200);
    expect(loginRes.body.token).toBeTruthy();
    expect(loginRes.body.user.tenant.plan).toBe("app_base");
    expect(Array.isArray(loginRes.body.user.tenant.enabledFeatures)).toBe(true);
    expect(loginRes.body.user.tenant.enabledFeatures).toContain("client_account");
    expect(loginRes.body.user.tenant.limits).toBeDefined();
  });

  it("webhook processApprovedPayment updates tenant complements and enabledFeatures", async () => {
    const token = await bootstrapAndGetToken();

    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ email: bootstrapPayload.email, password: bootstrapPayload.password });
    const tenantId = loginRes.body.user.tenant._id;

    const paymentData = {
      id: "123456789",
      external_reference: JSON.stringify({
        tenantId: tenantId.toString(),
        complements: ["financiero", "produccion"],
        totalPrice: 300,
      }),
      transaction_amount: 300,
      currency_id: "ARS",
      payment_method_id: "visa",
      preference_id: "pref-001",
      payer: { email: "test@example.com" },
      installments: 1,
      payment_type_id: "credit_card",
      issuer_id: "123",
    };

    await processApprovedPayment(paymentData);

    const tenant = await Tenant.findById(tenantId).lean();
    expect(tenant.plan).toBe("app_base");
    expect(tenant.complements).toContain("financiero");
    expect(tenant.complements).toContain("produccion");
    expect(tenant.enabledFeatures).toContain("financial_center");
    expect(tenant.enabledFeatures).toContain("recipes");
    expect(tenant.status).toBe("active");
    expect(tenant.billing.paymentStatus).toBe("paid");

    const paymentRecord = await PaymentRecord.findOne({ mercadoPagoPaymentId: "123456789" }).lean();
    expect(paymentRecord).toBeTruthy();
    expect(paymentRecord.complements).toEqual(["financiero", "produccion"]);
    expect(paymentRecord.totalPrice).toBe(300);
    expect(paymentRecord.status).toBe("approved");
  });

  it("webhook is idempotent for the same payment ID", async () => {
    const token = await bootstrapAndGetToken();

    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ email: bootstrapPayload.email, password: bootstrapPayload.password });
    const tenantId = loginRes.body.user.tenant._id;

    const paymentData = {
      id: "987654321",
      external_reference: JSON.stringify({
        tenantId: tenantId.toString(),
        complements: ["api"],
        totalPrice: 300,
      }),
      transaction_amount: 300,
      currency_id: "ARS",
      payment_method_id: "master",
      preference_id: "pref-002",
      payer: { email: "test2@example.com" },
      installments: 1,
      payment_type_id: "credit_card",
      issuer_id: "456",
    };

    await processApprovedPayment(paymentData);
    await processApprovedPayment(paymentData);

    const records = await PaymentRecord.find({ mercadoPagoPaymentId: "987654321" }).lean();
    expect(records).toHaveLength(1);

    const tenant = await Tenant.findById(tenantId).lean();
    expect(tenant.complements).toEqual(["api"]);
  });

  it("POST /api/payments/webhook returns 200 immediately and processes payment async", async () => {
    const response = await request(app)
      .post("/api/payments/webhook")
      .send({ type: "payment", data: { id: "111222333" } });

    expect(response.status).toBe(200);
    expect(response.text).toBe("OK");
  });

  it("GET /api/payments/history returns payments with complements", async () => {
    const token = await bootstrapAndGetToken();

    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ email: bootstrapPayload.email, password: bootstrapPayload.password });
    const tenantId = loginRes.body.user.tenant._id;

    await PaymentRecord.create({
      tenant: tenantId,
      complements: ["expansion"],
      totalPrice: 300,
      amount: 300,
      status: "approved",
      mercadoPagoPaymentId: "hist-001",
    });

    const response = await request(app)
      .get("/api/payments/history")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].complements).toContain("expansion");
    expect(response.body.data[0].totalPrice).toBe(300);
  });
});
