const mongoose = require("mongoose");
const request = require("supertest");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test_jwt_secret_123";
process.env.ADMIN_SETUP_KEY = "test_setup_key_123";
process.env.AUTH_BOOTSTRAP_ENABLED = "true";
process.env.CORS_ORIGINS = "http://localhost:5173";

const { createApp } = require("../../src/app");
const Tenant = require("../../src/models/tenant.model");
const User = require("../../src/models/user.model");

let mongoServer;
let app;

const bootstrapPayload = {
  setupKey: process.env.ADMIN_SETUP_KEY,
  fullName: "Test Admin",
  email: "admin@test.local",
  password: "secret123",
  storeName: "Test Store",
};

async function bootstrapAndGetToken() {
  const bootstrapResponse = await request(app)
    .post("/api/auth/bootstrap-superadmin")
    .set("X-Forwarded-For", "127.0.0.1")
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

describe("Experience Modes — Backend", () => {

  // ── Test 4.1: /auth/me includes experienceMode for new tenants ──
  it("returns experienceMode 'simple' in /auth/me for a new tenant", async () => {
    const token = await bootstrapAndGetToken();

    const meResponse = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${token}`);

    expect(meResponse.status).toBe(200);
    expect(meResponse.body.user).toBeDefined();
    expect(meResponse.body.user.tenant).toBeDefined();
    expect(meResponse.body.user.tenant.experienceMode).toBe("simple");
  });

  // ── Test 4.1b: GET /tenant/plan includes experienceMode ──
  it("returns experienceMode in /tenant/plan for a regular tenant", async () => {
    const token = await bootstrapAndGetToken();

    const planResponse = await request(app)
      .get("/api/tenant/plan")
      .set("Authorization", `Bearer ${token}`);

    expect(planResponse.status).toBe(200);
    expect(planResponse.body.success).toBe(true);
    expect(planResponse.body.plan).toBeDefined();
    expect(planResponse.body.plan.experienceMode).toBe("simple");
  });

  // ── Test 4.2: PATCH /superadmin/tenants/:id accepts and persists experienceMode ──
  it("persists experienceMode via PATCH and rejects invalid values", async () => {
    const token = await bootstrapAndGetToken();

    // List tenants to get the tenant ID
    const listResponse = await request(app)
      .get("/api/superadmin/tenants")
      .set("Authorization", `Bearer ${token}`);

    expect(listResponse.status).toBe(200);
    expect(listResponse.body.tenants.length).toBeGreaterThan(0);
    const tenantId = listResponse.body.tenants[0]._id;

    // PATCH with valid mode
    const patchResponse = await request(app)
      .patch(`/api/superadmin/tenants/${tenantId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ experienceMode: "intermediate" });

    expect(patchResponse.status).toBe(200);
    expect(patchResponse.body.success).toBe(true);
    expect(patchResponse.body.tenant.experienceMode).toBe("intermediate");

    // Verify in DB
    const tenant = await Tenant.findById(tenantId).lean();
    expect(tenant.experienceMode).toBe("intermediate");

    // PATCH with invalid mode — must return 400
    const invalidPatch = await request(app)
      .patch(`/api/superadmin/tenants/${tenantId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ experienceMode: "premium" });

    expect(invalidPatch.status).toBe(400);
  });
});
