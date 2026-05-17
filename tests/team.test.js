/**
 * @fileoverview Integration tests for Team/Users API endpoints
 * Tests list, create, update, toggle active, delete, and duplicate email scenarios.
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
    plan: "app_base",
    complements: ["expansion", "team_10", "financiero", "bom", "produccion"],
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

describe("Team / Users API", () => {
  let token;

  beforeEach(async () => {
    token = await bootstrapAndGetToken();
  });

  describe("GET /api/team", () => {
    it("should list team members", async () => {
      const response = await request(app)
        .get("/api/team")
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThanOrEqual(1);
      expect(response.body[0]).toHaveProperty("_id");
      expect(response.body[0]).toHaveProperty("fullName");
      expect(response.body[0]).toHaveProperty("email");
      expect(response.body[0]).toHaveProperty("role");
      expect(response.body[0]).toHaveProperty("isActive");
      expect(response.body[0]).toHaveProperty("roleLabel");
      expect(response.body[0]).toHaveProperty("createdAt");
      // Should NOT expose passwordHash
      expect(response.body[0]).not.toHaveProperty("passwordHash");
    });

    it("should require authentication", async () => {
      const response = await request(app).get("/api/team");

      expect(response.status).toBe(401);
    });
  });

  describe("POST /api/team", () => {
    it("should create a new team member", async () => {
      const response = await request(app)
        .post("/api/team")
        .set("Authorization", `Bearer ${token}`)
        .send({
          fullName: "New Member",
          email: "new@test.local",
          password: "secret456",
          role: "ventas",
        });

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty("_id");
      expect(response.body.fullName).toBe("New Member");
      expect(response.body.email).toBe("new@test.local");
      expect(response.body.role).toBe("ventas");
      expect(response.body.roleLabel).toBe("Ventas");
      expect(response.body.isActive).toBe(true);
      expect(response.body).not.toHaveProperty("passwordHash");
    });

    it("should create with default role when role is invalid", async () => {
      const response = await request(app)
        .post("/api/team")
        .set("Authorization", `Bearer ${token}`)
        .send({
          fullName: "Default Role",
          email: "defaultrole@test.local",
          password: "secret456",
          role: "invalid_role",
        });

      expect(response.status).toBe(201);
      expect(response.body.role).toBe("lectura");
      expect(response.body.roleLabel).toBe("Solo lectura");
    });

    it("should return 409 when email already exists", async () => {
      // Create first member
      await request(app)
        .post("/api/team")
        .set("Authorization", `Bearer ${token}`)
        .send({
          fullName: "Original",
          email: "dupe@test.local",
          password: "secret456",
          role: "ventas",
        });

      // Try creating with same email
      const response = await request(app)
        .post("/api/team")
        .set("Authorization", `Bearer ${token}`)
        .send({
          fullName: "Duplicate",
          email: "dupe@test.local",
          password: "secret789",
          role: "admin",
        });

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe("EMAIL_ALREADY_EXISTS");
    });

    it("should return 400 on validation failure (short password)", async () => {
      const response = await request(app)
        .post("/api/team")
        .set("Authorization", `Bearer ${token}`)
        .send({
          fullName: "Bad Data",
          email: "bad@test.local",
          password: "12",
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("should require authentication", async () => {
      const response = await request(app)
        .post("/api/team")
        .send({
          fullName: "No Auth",
          email: "noauth@test.local",
          password: "secret456",
        });

      expect(response.status).toBe(401);
    });
  });

  describe("PATCH /api/team/:id", () => {
    let memberId;

    beforeEach(async () => {
      const createRes = await request(app)
        .post("/api/team")
        .set("Authorization", `Bearer ${token}`)
        .send({
          fullName: "Update Target",
          email: `update-${Date.now()}@test.local`,
          password: "secret456",
          role: "ventas",
        });
      memberId = createRes.body._id;
    });

    it("should update team member role", async () => {
      const response = await request(app)
        .patch(`/api/team/${memberId}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ role: "deposito" });

      expect(response.status).toBe(200);
      expect(response.body.role).toBe("deposito");
      expect(response.body.roleLabel).toBe("Depósito");
    });

    it("should toggle active status", async () => {
      const response = await request(app)
        .patch(`/api/team/${memberId}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ isActive: false });

      expect(response.status).toBe(200);
      expect(response.body.isActive).toBe(false);
    });

    it("should update fullName", async () => {
      const response = await request(app)
        .patch(`/api/team/${memberId}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ fullName: "Updated Name" });

      expect(response.status).toBe(200);
      expect(response.body.fullName).toBe("Updated Name");
    });

    it("should return 400 when editing self", async () => {
      const listRes = await request(app)
        .get("/api/team")
        .set("Authorization", `Bearer ${token}`);
      const admin = listRes.body.find((u) => u.email === "admin@test.local");

      const response = await request(app)
        .patch(`/api/team/${admin._id}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ role: "lectura" });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("SELF_EDIT");
    });

    it("should return 404 for non-existent member", async () => {
      const fakeId = new mongoose.Types.ObjectId();
      const response = await request(app)
        .patch(`/api/team/${fakeId}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ role: "admin" });

      expect(response.status).toBe(404);
    });

    it("should return 400 when :id is not a valid ObjectId", async () => {
      const response = await request(app)
        .patch("/api/team/not-an-id")
        .set("Authorization", `Bearer ${token}`)
        .send({ role: "admin" });

      expect(response.status).toBe(400);
    });

    it("should require authentication", async () => {
      const response = await request(app)
        .patch(`/api/team/${memberId}`)
        .send({ role: "admin" });

      expect(response.status).toBe(401);
    });
  });

  describe("DELETE /api/team/:id", () => {
    let memberId;

    beforeEach(async () => {
      const createRes = await request(app)
        .post("/api/team")
        .set("Authorization", `Bearer ${token}`)
        .send({
          fullName: "Delete Target",
          email: `delete-${Date.now()}@test.local`,
          password: "secret456",
          role: "ventas",
        });
      memberId = createRes.body._id;
    });

    it("should deactivate a team member", async () => {
      const response = await request(app)
        .delete(`/api/team/${memberId}`)
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.member.isActive).toBe(false);
    });

    it("should return 400 when deleting self", async () => {
      const listRes = await request(app)
        .get("/api/team")
        .set("Authorization", `Bearer ${token}`);
      const admin = listRes.body.find((u) => u.email === "admin@test.local");

      const response = await request(app)
        .delete(`/api/team/${admin._id}`)
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("SELF_DELETE");
    });

    it("should return 404 for non-existent member", async () => {
      const fakeId = new mongoose.Types.ObjectId();
      const response = await request(app)
        .delete(`/api/team/${fakeId}`)
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(404);
    });

    it("should require authentication", async () => {
      const response = await request(app)
        .delete(`/api/team/${memberId}`);

      expect(response.status).toBe(401);
    });
  });
});
