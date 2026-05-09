/**
 * @fileoverview Integration tests for Quotes API endpoints
 * Tests CRUD, status transitions (send/accept/reject/convert), and validation.
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

describe("Quotes API", () => {
  let token;
  let clientId;

  beforeEach(async () => {
    token = await bootstrapAndGetToken();
  });

  async function createTestClient() {
    const res = await request(app)
      .post("/api/clients")
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: "Cliente Test",
        phone: "5491111111111",
        taxId: "20-11111111-1",
      });
    expect(res.status).toBe(201);
    clientId = res.body._id;
  }

  const quoteBase = () => ({
    client: clientId,
    date: "2026-05-09",
    items: [
      { product: "Producto A", quantity: 2, price: 100, lineTotal: 200 },
    ],
    subtotal: 200,
    total: 200,
  });

  describe("POST /api/quotes", () => {
    beforeEach(async () => {
      await createTestClient();
    });

    it("debería crear un presupuesto con número de cotización", async () => {
      const response = await request(app)
        .post("/api/quotes")
        .set("Authorization", `Bearer ${token}`)
        .send(quoteBase());

      expect(response.status).toBe(201);
      expect(response.body.quoteNumber).toMatch(/^COT-/);
      expect(response.body.status).toBe("DRAFT");
      expect(response.body.client).toBe(clientId);
      expect(response.body.items).toHaveLength(1);
      expect(response.body.total).toBe(200);
    });

    it("debería devolver error de validación con datos inválidos", async () => {
      const response = await request(app)
        .post("/api/quotes")
        .set("Authorization", `Bearer ${token}`)
        .send({});

      expect(response.status).toBe(400);
    });
  });

  describe("GET /api/quotes", () => {
    beforeEach(async () => {
      await createTestClient();
    });

    it("debería listar presupuestos paginados", async () => {
      // Create two quotes
      await request(app)
        .post("/api/quotes")
        .set("Authorization", `Bearer ${token}`)
        .send(quoteBase());

      await request(app)
        .post("/api/quotes")
        .set("Authorization", `Bearer ${token}`)
        .send({
          ...quoteBase(),
          items: [{ product: "Producto B", quantity: 1, price: 300, lineTotal: 300 }],
          subtotal: 300,
          total: 300,
        });

      const response = await request(app)
        .get("/api/quotes?page=1&limit=10")
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.quotes).toHaveLength(2);
      expect(response.body.total).toBe(2);
      expect(response.body.currentPage).toBe(1);
    });
  });

  describe("GET /api/quotes/:id", () => {
    let quoteId;

    beforeEach(async () => {
      await createTestClient();
      const createRes = await request(app)
        .post("/api/quotes")
        .set("Authorization", `Bearer ${token}`)
        .send(quoteBase());
      quoteId = createRes.body._id;
    });

    it("debería obtener un presupuesto por ID con sus items", async () => {
      const response = await request(app)
        .get(`/api/quotes/${quoteId}`)
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body._id).toBe(quoteId);
      expect(response.body.items).toHaveLength(1);
      expect(response.body.items[0].product).toBe("Producto A");
      expect(response.body.client).toBeTruthy();
    });

    it("debería devolver 404 para ID inexistente", async () => {
      const fakeId = new mongoose.Types.ObjectId();
      const response = await request(app)
        .get(`/api/quotes/${fakeId}`)
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(404);
    });
  });

  describe("PUT /api/quotes/:id", () => {
    let quoteId;

    beforeEach(async () => {
      await createTestClient();
      const createRes = await request(app)
        .post("/api/quotes")
        .set("Authorization", `Bearer ${token}`)
        .send(quoteBase());
      quoteId = createRes.body._id;
    });

    it("debería actualizar un presupuesto en borrador", async () => {
      const response = await request(app)
        .put(`/api/quotes/${quoteId}`)
        .set("Authorization", `Bearer ${token}`)
        .send({
          notes: "Nota actualizada",
          total: 250,
        });

      expect(response.status).toBe(200);
      expect(response.body.notes).toBe("Nota actualizada");
      expect(response.body.total).toBe(250);
      expect(response.body.status).toBe("DRAFT");
    });

    it("debería devolver 404 al actualizar ID inexistente", async () => {
      const fakeId = new mongoose.Types.ObjectId();
      const response = await request(app)
        .put(`/api/quotes/${fakeId}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ notes: "Test" });

      expect(response.status).toBe(404);
    });
  });

  describe("POST /api/quotes/:id/send", () => {
    let quoteId;

    beforeEach(async () => {
      await createTestClient();
      const createRes = await request(app)
        .post("/api/quotes")
        .set("Authorization", `Bearer ${token}`)
        .send(quoteBase());
      quoteId = createRes.body._id;
    });

    it("debería enviar un presupuesto (DRAFT → SENT)", async () => {
      const response = await request(app)
        .post(`/api/quotes/${quoteId}/send`)
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.status).toBe("SENT");
    });
  });

  describe("POST /api/quotes/:id/accept", () => {
    let quoteId;

    beforeEach(async () => {
      await createTestClient();
      const createRes = await request(app)
        .post("/api/quotes")
        .set("Authorization", `Bearer ${token}`)
        .send(quoteBase());
      quoteId = createRes.body._id;

      // Send first (DRAFT → SENT)
      await request(app)
        .post(`/api/quotes/${quoteId}/send`)
        .set("Authorization", `Bearer ${token}`);
    });

    it("debería aceptar un presupuesto (SENT → ACCEPTED)", async () => {
      const response = await request(app)
        .post(`/api/quotes/${quoteId}/accept`)
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.status).toBe("ACCEPTED");
    });
  });

  describe("POST /api/quotes/:id/convert", () => {
    let quoteId;

    beforeEach(async () => {
      await createTestClient();
      const createRes = await request(app)
        .post("/api/quotes")
        .set("Authorization", `Bearer ${token}`)
        .send(quoteBase());
      quoteId = createRes.body._id;

      // Full flow: DRAFT → SENT → ACCEPTED
      await request(app)
        .post(`/api/quotes/${quoteId}/send`)
        .set("Authorization", `Bearer ${token}`);

      await request(app)
        .post(`/api/quotes/${quoteId}/accept`)
        .set("Authorization", `Bearer ${token}`);
    });

    it("debería convertir un presupuesto aceptado en orden", async () => {
      const response = await request(app)
        .post(`/api/quotes/${quoteId}/convert`)
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(201);
      expect(response.body.quote).toBeTruthy();
      expect(response.body.quote.status).toBe("CONVERTED");
      expect(response.body.order).toBeTruthy();
      expect(response.body.order.totalAmount).toBe(200);
      expect(response.body.order.notes).toContain("Creado desde presupuesto");
    });
  });

  describe("POST /api/quotes/:id/reject", () => {
    it("debería rechazar un presupuesto en borrador (DRAFT → REJECTED)", async () => {
      await createTestClient();
      const createRes = await request(app)
        .post("/api/quotes")
        .set("Authorization", `Bearer ${token}`)
        .send(quoteBase());

      const response = await request(app)
        .post(`/api/quotes/${createRes.body._id}/reject`)
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.status).toBe("REJECTED");
    });

    it("debería rechazar un presupuesto enviado (SENT → REJECTED)", async () => {
      await createTestClient();
      const createRes = await request(app)
        .post("/api/quotes")
        .set("Authorization", `Bearer ${token}`)
        .send(quoteBase());
      const quoteId = createRes.body._id;

      await request(app)
        .post(`/api/quotes/${quoteId}/send`)
        .set("Authorization", `Bearer ${token}`);

      const response = await request(app)
        .post(`/api/quotes/${quoteId}/reject`)
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.status).toBe("REJECTED");
    });
  });
});
