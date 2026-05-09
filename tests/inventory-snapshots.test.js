/**
 * @fileoverview Integration tests for Inventory Snapshots API endpoints
 * Tests trigger, list, getById, and auth scenarios.
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

describe("Inventory Snapshots API", () => {
  let token;

  beforeEach(async () => {
    token = await bootstrapAndGetToken();
  });

  describe("POST /api/inventory-snapshots/trigger", () => {
    it("debería crear un snapshot con productos", async () => {
      // Create a product first so the snapshot has items
      const productRes = await request(app)
        .post("/api/products")
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "Producto Test",
          price: 100,
          stock: 10,
          costPrice: 50,
        });
      expect(productRes.status).toBe(201);

      const response = await request(app)
        .post("/api/inventory-snapshots/trigger")
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.items).toHaveLength(1);
      expect(response.body.data.productCount).toBe(1);
      expect(response.body.data.items[0].productName).toBe("Producto Test");
      expect(response.body.data.items[0].stock).toBe(10);
      expect(response.body.data.items[0].stockValue).toBe(500); // 10 * 50
      expect(response.body.data.stockValue).toBe(500);
      expect(response.body.data.triggeredBy).toBe("manual");
    });

    it("debería crear un snapshot sin productos", async () => {
      const response = await request(app)
        .post("/api/inventory-snapshots/trigger")
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.items).toEqual([]);
      expect(response.body.data.productCount).toBe(0);
      expect(response.body.data.stockValue).toBe(0);
    });

    it("debería requerir autenticación", async () => {
      const response = await request(app)
        .post("/api/inventory-snapshots/trigger");

      expect(response.status).toBe(401);
    });
  });

  describe("GET /api/inventory-snapshots", () => {
    it("debería listar snapshots paginados", async () => {
      // Create two snapshots
      await request(app)
        .post("/api/inventory-snapshots/trigger")
        .set("Authorization", `Bearer ${token}`);

      await request(app)
        .post("/api/inventory-snapshots/trigger")
        .set("Authorization", `Bearer ${token}`);

      const response = await request(app)
        .get("/api/inventory-snapshots")
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(2);
      expect(response.body.pagination).toBeDefined();
      expect(response.body.pagination.total).toBe(2);
      expect(response.body.pagination.page).toBe(1);
    });

    it("debería devolver lista vacía sin snapshots", async () => {
      const response = await request(app)
        .get("/api/inventory-snapshots")
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual([]);
      expect(response.body.pagination.total).toBe(0);
    });
  });

  describe("GET /api/inventory-snapshots/:id", () => {
    let snapshotId;

    beforeEach(async () => {
      const createRes = await request(app)
        .post("/api/inventory-snapshots/trigger")
        .set("Authorization", `Bearer ${token}`);
      snapshotId = createRes.body.data._id;
    });

    it("debería obtener un snapshot por ID con detalle completo", async () => {
      const response = await request(app)
        .get(`/api/inventory-snapshots/${snapshotId}`)
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data._id).toBe(snapshotId);
      // Full detail includes items (unlike list which excludes them)
      expect(response.body.data.items).toBeDefined();
      expect(response.body.data.snapshotDate).toBeTruthy();
      expect(response.body.data.productCount).toBe(0);
    });

    it("debería devolver 404 para ID inexistente", async () => {
      const fakeId = new mongoose.Types.ObjectId();
      const response = await request(app)
        .get(`/api/inventory-snapshots/${fakeId}`)
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(404);
    });
  });
});
