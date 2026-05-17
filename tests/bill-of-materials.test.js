/**
 * @fileoverview Integration tests for Bill of Materials API endpoints
 * Tests CRUD, produce, production logs, and validation.
 *
 * NOTE: The /api/supplies endpoint creates Products with type=raw_material,
 * so BOM ingredients use productItemId to reference them.
 * See supplyController.js → productItemId mapping.
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

describe("Bill of Materials API", () => {
  let token;
  let productId; // ID of the Product created via POST /api/supplies

  beforeEach(async () => {
    token = await bootstrapAndGetToken();

    // Create a "supply" via the API — it actually creates a Product with type=raw_material
    const supplyRes = await request(app)
      .post("/api/supplies")
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: "Harina",
        unit: "kg",
        currentStock: 100,
        minStock: 10,
        referenceCost: 50,
      });
    expect(supplyRes.status).toBe(201);
    productId = supplyRes.body._id;
  });

  describe("POST /api/bill-of-materials", () => {
    it("should create a BOM → 201, has name, ingredients", async () => {
      const response = await request(app)
        .post("/api/bill-of-materials")
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "Masa de Pizza",
          yieldQuantity: 10,
          ingredients: [
            { productItemId: productId, quantity: 5 },
          ],
          notes: "Receta básica",
        });

      expect(response.status).toBe(201);
      expect(response.body.name).toBe("Masa de Pizza");
      expect(response.body.yieldQuantity).toBe(10);
      expect(response.body.ingredients).toHaveLength(1);
      expect(response.body.ingredients[0].product).toBeTruthy();
      expect(response.body.ingredients[0].quantity).toBe(5);
      expect(response.body.notes).toBe("Receta básica");
      expect(response.body.isActive).toBe(true);
      expect(response.body.deletedAt).toBeNull();
    });

    it("should create BOM without optional fields", async () => {
      const response = await request(app)
        .post("/api/bill-of-materials")
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "Simple BOM",
        });

      expect(response.status).toBe(201);
      expect(response.body.name).toBe("Simple BOM");
      expect(response.body.yieldQuantity).toBe(1);
      expect(response.body.ingredients).toEqual([]);
      expect(response.body.notes).toBe("");
    });

    it("should return 400 when name is missing", async () => {
      const response = await request(app)
        .post("/api/bill-of-materials")
        .set("Authorization", `Bearer ${token}`)
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error?.code).toBe("VALIDATION_ERROR");
    });

    it("should return 409 when name is duplicated", async () => {
      await request(app)
        .post("/api/bill-of-materials")
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Duplicada" });

      const response = await request(app)
        .post("/api/bill-of-materials")
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Duplicada" });

      expect(response.status).toBe(409);
      expect(response.body.error?.code).toBe("BOM_ALREADY_EXISTS");
    });

    it("should require authentication", async () => {
      const response = await request(app)
        .post("/api/bill-of-materials")
        .send({ name: "No Auth" });

      expect(response.status).toBe(401);
    });
  });

  describe("GET /api/bill-of-materials", () => {
    it("should list BOMs → 200, with populated fields", async () => {
      await request(app)
        .post("/api/bill-of-materials")
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "BOM Alpha", ingredients: [{ productItemId: productId, quantity: 2 }] });

      await request(app)
        .post("/api/bill-of-materials")
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "BOM Beta", ingredients: [{ productItemId: productId, quantity: 3 }] });

      const response = await request(app)
        .get("/api/bill-of-materials")
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBe(2);
      // Sorted by name ascending
      expect(response.body[0].name).toBe("BOM Alpha");
      expect(response.body[1].name).toBe("BOM Beta");
      // Has populated ingredients
      expect(response.body[0].ingredients[0].product).toBeTruthy();
    });

    it("should exclude soft-deleted BOMs by default", async () => {
      const createRes = await request(app)
        .post("/api/bill-of-materials")
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "To Delete" });

      await request(app)
        .delete(`/api/bill-of-materials/${createRes.body._id}`)
        .set("Authorization", `Bearer ${token}`);

      const response = await request(app)
        .get("/api/bill-of-materials")
        .set("Authorization", `Bearer ${token}`);

      expect(response.body).toHaveLength(0);
    });

    it("should include inactive BOMs when includeInactive=true", async () => {
      const createRes = await request(app)
        .post("/api/bill-of-materials")
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Inactive BOM" });

      await request(app)
        .delete(`/api/bill-of-materials/${createRes.body._id}`)
        .set("Authorization", `Bearer ${token}`);

      const response = await request(app)
        .get("/api/bill-of-materials?includeInactive=true")
        .set("Authorization", `Bearer ${token}`);

      expect(response.body).toHaveLength(1);
      expect(response.body[0].isActive).toBe(false);
    });
  });

  describe("GET /api/bill-of-materials/:id", () => {
    it("should get BOM by ID → 200, with populated fields", async () => {
      const createRes = await request(app)
        .post("/api/bill-of-materials")
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "Specific BOM",
          ingredients: [{ productItemId: productId, quantity: 1 }],
        });

      const response = await request(app)
        .get(`/api/bill-of-materials/${createRes.body._id}`)
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body._id).toBe(createRes.body._id);
      expect(response.body.name).toBe("Specific BOM");
      expect(response.body.ingredients[0].product).toBeTruthy();
    });

    it("should return 404 for non-existent BOM", async () => {
      const fakeId = new mongoose.Types.ObjectId();
      const response = await request(app)
        .get(`/api/bill-of-materials/${fakeId}`)
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(404);
      expect(response.body.error?.code).toBe("BOM_NOT_FOUND");
    });

    it("should return 404 for soft-deleted BOM", async () => {
      const createRes = await request(app)
        .post("/api/bill-of-materials")
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Gone" });

      await request(app)
        .delete(`/api/bill-of-materials/${createRes.body._id}`)
        .set("Authorization", `Bearer ${token}`);

      const response = await request(app)
        .get(`/api/bill-of-materials/${createRes.body._id}`)
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(404);
    });
  });

  describe("PATCH /api/bill-of-materials/:id", () => {
    it("should update BOM → 200, fields updated", async () => {
      const createRes = await request(app)
        .post("/api/bill-of-materials")
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "Original Name",
          yieldQuantity: 1,
        });

      const response = await request(app)
        .patch(`/api/bill-of-materials/${createRes.body._id}`)
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "Updated Name",
          yieldQuantity: 5,
          notes: "Updated notes",
        });

      expect(response.status).toBe(200);
      expect(response.body.name).toBe("Updated Name");
      expect(response.body.yieldQuantity).toBe(5);
      expect(response.body.notes).toBe("Updated notes");
    });

    it("should return 409 when updating to duplicate name", async () => {
      await request(app)
        .post("/api/bill-of-materials")
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Existing BOM" });

      const createRes = await request(app)
        .post("/api/bill-of-materials")
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Other BOM" });

      const response = await request(app)
        .patch(`/api/bill-of-materials/${createRes.body._id}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Existing BOM" });

      expect(response.status).toBe(409);
      expect(response.body.error?.code).toBe("BOM_ALREADY_EXISTS");
    });

    it("should return 404 for non-existent BOM", async () => {
      const fakeId = new mongoose.Types.ObjectId();
      const response = await request(app)
        .patch(`/api/bill-of-materials/${fakeId}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Nope" });

      expect(response.status).toBe(404);
    });
  });

  describe("DELETE /api/bill-of-materials/:id", () => {
    it("should soft-delete BOM → 200, deletedAt set", async () => {
      const createRes = await request(app)
        .post("/api/bill-of-materials")
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "To Delete" });

      const response = await request(app)
        .delete(`/api/bill-of-materials/${createRes.body._id}`)
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.message).toBeTruthy();
      expect(response.body.bom.isActive).toBe(false);
      expect(response.body.bom.deletedAt).toBeTruthy();
    });

    it("should return 404 for non-existent BOM", async () => {
      const fakeId = new mongoose.Types.ObjectId();
      const response = await request(app)
        .delete(`/api/bill-of-materials/${fakeId}`)
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(404);
    });

    it("should return 404 for already deleted BOM", async () => {
      const createRes = await request(app)
        .post("/api/bill-of-materials")
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Double Delete" });

      await request(app)
        .delete(`/api/bill-of-materials/${createRes.body._id}`)
        .set("Authorization", `Bearer ${token}`);

      const response = await request(app)
        .delete(`/api/bill-of-materials/${createRes.body._id}`)
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(404);
    });
  });

  describe("POST /api/bill-of-materials/:id/produce", () => {
    it("should produce from BOM → 200, returns batches/units produced", async () => {
      const createRes = await request(app)
        .post("/api/bill-of-materials")
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "Producible",
          yieldQuantity: 10,
          ingredients: [{ productItemId: productId, quantity: 2 }],
        });
      const bomId = createRes.body._id;

      const response = await request(app)
        .post(`/api/bill-of-materials/${bomId}/produce`)
        .set("Authorization", `Bearer ${token}`)
        .send({ quantity: 3, notes: "Test production" });

      expect(response.status).toBe(200);
      expect(response.body.billOfMaterial).toBeTruthy();
      expect(response.body.batchesProduced).toBe(3);
      expect(response.body.unitsProduced).toBe(30); // yieldQuantity(10) * batches(3)
      expect(response.body.ingredientsUsed).toBe(1);
    });

    it("should default to 1 batch when quantity is not provided", async () => {
      const createRes = await request(app)
        .post("/api/bill-of-materials")
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "Single Batch",
          yieldQuantity: 5,
          ingredients: [{ productItemId: productId, quantity: 1 }],
        });

      const response = await request(app)
        .post(`/api/bill-of-materials/${createRes.body._id}/produce`)
        .set("Authorization", `Bearer ${token}`)
        .send({});

      expect(response.status).toBe(200);
      expect(response.body.batchesProduced).toBe(1);
      expect(response.body.unitsProduced).toBe(5);
    });

    it("should return 422 when stock is insufficient", async () => {
      // Create supply with zero stock
      const lowSupplyRes = await request(app)
        .post("/api/supplies")
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "Low Stock Item",
          unit: "unidad",
          currentStock: 1,
        });
      const lowSupplyId = lowSupplyRes.body._id;

      const createRes = await request(app)
        .post("/api/bill-of-materials")
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "Starving BOM",
          ingredients: [{ productItemId: lowSupplyId, quantity: 10 }],
        });

      const response = await request(app)
        .post(`/api/bill-of-materials/${createRes.body._id}/produce`)
        .set("Authorization", `Bearer ${token}`)
        .send({ quantity: 1 });

      expect(response.status).toBe(422);
      expect(response.body.error?.code).toBe("INSUFFICIENT_STOCK");
      expect(response.body.error?.details?.shortages).toBeDefined();
    });

    it("should return 404 for non-existent BOM", async () => {
      const fakeId = new mongoose.Types.ObjectId();
      const response = await request(app)
        .post(`/api/bill-of-materials/${fakeId}/produce`)
        .set("Authorization", `Bearer ${token}`)
        .send({ quantity: 1 });

      expect(response.status).toBe(404);
    });
  });

  describe("GET /api/bill-of-materials/production-logs", () => {
    it("should list production logs → 200", async () => {
      const createRes = await request(app)
        .post("/api/bill-of-materials")
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "Log Test",
          yieldQuantity: 1,
          ingredients: [{ productItemId: productId, quantity: 1 }],
        });

      // Produce once to create a log
      const produceRes = await request(app)
        .post(`/api/bill-of-materials/${createRes.body._id}/produce`)
        .set("Authorization", `Bearer ${token}`)
        .send({ quantity: 2 });
      expect(produceRes.status).toBe(200);

      const response = await request(app)
        .get("/api/bill-of-materials/production-logs")
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBe(1);
      expect(response.body[0].recipeName).toBe("Log Test");
      expect(response.body[0].batchesProduced).toBe(2);
      expect(response.body[0].unitsProduced).toBe(2);
    });

    it("should empty list when no production yet", async () => {
      const response = await request(app)
        .get("/api/bill-of-materials/production-logs")
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual([]);
    });
  });

  describe("GET /api/bill-of-materials/:id/production-logs", () => {
    it("should get production logs for a specific BOM → 200, filtered", async () => {
      const bomARes = await request(app)
        .post("/api/bill-of-materials")
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "BOM A",
          yieldQuantity: 2,
          ingredients: [{ productItemId: productId, quantity: 1 }],
        });

      const bomBRes = await request(app)
        .post("/api/bill-of-materials")
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "BOM B",
          yieldQuantity: 3,
          ingredients: [{ productItemId: productId, quantity: 1 }],
        });

      // Produce from both (need more stock — each produce deducts ingredients)
      // Create a second supply to ensure enough stock
      const supplyExtraRes = await request(app)
        .post("/api/supplies")
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "Extra Stock",
          unit: "kg",
          currentStock: 100,
        });
      const extraId = supplyExtraRes.body._id;

      // Re-create BOM A with extra stock supply and produce
      const bomA2Res = await request(app)
        .post("/api/bill-of-materials")
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "BOM A Fresh",
          yieldQuantity: 2,
          ingredients: [{ productItemId: extraId, quantity: 1 }],
        });

      await request(app)
        .post(`/api/bill-of-materials/${bomBRes.body._id}/produce`)
        .set("Authorization", `Bearer ${token}`)
        .send({ quantity: 1 });

      await request(app)
        .post(`/api/bill-of-materials/${bomA2Res.body._id}/produce`)
        .set("Authorization", `Bearer ${token}`)
        .send({ quantity: 1 });

      // Get logs for BOM A (fresh) only
      const response = await request(app)
        .get(`/api/bill-of-materials/${bomA2Res.body._id}/production-logs`)
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body).toHaveLength(1);
      expect(response.body[0].recipeName).toBe("BOM A Fresh");
    });

    it("should return empty array for BOM with no production", async () => {
      const createRes = await request(app)
        .post("/api/bill-of-materials")
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "No Production" });

      const response = await request(app)
        .get(`/api/bill-of-materials/${createRes.body._id}/production-logs`)
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual([]);
    });
  });
});
