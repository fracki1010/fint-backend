/**
 * @fileoverview Integration tests for Cost Center API endpoints
 * Tests CRUD, report generation, and order tagging.
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

  // Upgrade tenant to business so financial_center feature is available
  const settings = await Setting.findOne({});
  await Tenant.findByIdAndUpdate(settings.tenant, { plan: "business" });

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

describe("Cost Center API", () => {
  let token;

  beforeEach(async () => {
    token = await bootstrapAndGetToken();
  });

  describe("POST /api/cost-centers", () => {
    it("debe crear un centro de costo → 201", async () => {
      const res = await request(app)
        .post("/api/cost-centers")
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "Cocina",
          description: "Centro de costo de cocina",
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBe("Cocina");
      expect(res.body.data.description).toBe("Centro de costo de cocina");
      expect(res.body.data.isActive).toBe(true);
    });

    it("debe validar nombre requerido → error de validación", async () => {
      const res = await request(app)
        .post("/api/cost-centers")
        .set("Authorization", `Bearer ${token}`)
        .send({ description: "Sin nombre" });

      expect(res.status).toBe(400);
    });

    it("debe rechazar nombre duplicado → 409", async () => {
      await request(app)
        .post("/api/cost-centers")
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Cocina" });

      const res = await request(app)
        .post("/api/cost-centers")
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Cocina" });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("DUPLICATE");
    });
  });

  describe("GET /api/cost-centers", () => {
    it("debe listar centros de costo → 200", async () => {
      await request(app)
        .post("/api/cost-centers")
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Cocina" });

      await request(app)
        .post("/api/cost-centers")
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Bar" });

      const res = await request(app)
        .get("/api/cost-centers")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(2);
    });
  });

  describe("PUT /api/cost-centers/:id", () => {
    it("debe actualizar un centro de costo → 200", async () => {
      const created = await request(app)
        .post("/api/cost-centers")
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Cocina" });

      const res = await request(app)
        .put(`/api/cost-centers/${created.body.data._id}`)
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "Cocina Actualizada",
          description: "Nueva descripción",
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBe("Cocina Actualizada");
      expect(res.body.data.description).toBe("Nueva descripción");
    });

    it("debe retornar 404 si no existe", async () => {
      const fakeId = new mongoose.Types.ObjectId();
      const res = await request(app)
        .put(`/api/cost-centers/${fakeId}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Inexistente" });

      expect(res.status).toBe(404);
    });
  });

  describe("GET /api/cost-centers/report", () => {
    it("debe retornar reporte vacío cuando no hay datos → 200", async () => {
      const res = await request(app)
        .get("/api/cost-centers/report")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.rows).toEqual([]);
      expect(res.body.data.totals.revenue).toBe(0);
      expect(res.body.data.totals.costs).toBe(0);
    });

    it("debe retornar reporte con órdenes vinculadas → 200", async () => {
      // Crear centro de costo
      const centerRes = await request(app)
        .post("/api/cost-centers")
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Cocina" });
      const centerId = centerRes.body.data._id;

      // Crear producto y cliente
      const productRes = await request(app)
        .post("/api/products")
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Producto Test", price: 500, stock: 10 });
      expect(productRes.status).toBe(201);

      const clientRes = await request(app)
        .post("/api/clients")
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "Cliente Test",
          phone: "5491111111111",
          taxId: "20-11111111-1",
        });
      expect(clientRes.status).toBe(201);

      // Crear orden vinculada al centro de costo
      const orderRes = await request(app)
        .post("/api/orders")
        .set("Authorization", `Bearer ${token}`)
        .send({
          client: clientRes.body._id,
          items: [
            {
              product: "Producto Test",
              productId: productRes.body._id,
              quantity: 2,
              price: 500,
            },
          ],
          totalAmount: 1000,
          salesStatus: "Confirmada",
          paymentStatus: "Pagado",
          deliveryStatus: "Entregada",
          costCenter: centerId,
        });
      expect(orderRes.status).toBe(201);

      // Obtener reporte
      const res = await request(app)
        .get("/api/cost-centers/report")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.rows).toBeDefined();
      expect(res.body.data.totals).toBeDefined();

      const centerRow = res.body.data.rows.find((r) => r._id === centerId);
      expect(centerRow).toBeDefined();
      expect(centerRow.revenue).toBe(1000);
      expect(centerRow.orderCount).toBe(1);
    });
  });
});
