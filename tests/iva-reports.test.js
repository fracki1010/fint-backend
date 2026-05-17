/**
 * @fileoverview Integration tests for IVA Report API endpoints
 * Tests purchase and sales IVA reports with data, filtering, and empty states.
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

describe("IVA Reports API", () => {
  let token;

  beforeEach(async () => {
    token = await bootstrapAndGetToken();
  });

  describe("GET /api/reports/iva-purchases", () => {
    it("debe retornar reporte vacío cuando no hay compras → 200", async () => {
      const res = await request(app)
        .get("/api/reports/iva-purchases")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.periods).toEqual([]);
      expect(res.body.details).toEqual([]);
      expect(res.body.totals.netAmount).toBe(0);
      expect(res.body.totals.tax).toBe(0);
      expect(res.body.totals.total).toBe(0);
    });

    it("debe retornar compras con IVA desglosado → 200", async () => {
      // Crear producto para usar en items de compra
      const productRes = await request(app)
        .post("/api/products")
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Insumo Test", price: 0, stock: 100 });
      expect(productRes.status).toBe(201);

      // Crear proveedor
      const supplierRes = await request(app)
        .post("/api/suppliers")
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Proveedor Test" });
      expect(supplierRes.status).toBe(201);

      // Crear compra con IVA
      const purchaseRes = await request(app)
        .post("/api/purchases")
        .set("Authorization", `Bearer ${token}`)
        .send({
          supplierId: supplierRes.body._id,
          date: new Date().toISOString().slice(0, 10),
          paymentCondition: "CASH",
          subtotal: 1000,
          tax: 210,
          total: 1210,
          items: [
            {
              productItemId: productRes.body._id,
              quantity: 10,
              unitCost: 121,
              lineTotal: 1210,
            },
          ],
        });
      expect(purchaseRes.status).toBe(201);
      const purchaseId = purchaseRes.body._id || purchaseRes.body.data?._id;

      // Confirmar la compra para que aparezca en el reporte IVA
      const confirmRes = await request(app)
        .post(`/api/purchases/${purchaseId}/confirm`)
        .set("Authorization", `Bearer ${token}`);
      expect(confirmRes.status).toBe(200);

      // Obtener reporte de IVA compras
      const res = await request(app)
        .get("/api/reports/iva-purchases")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.periods.length).toBeGreaterThan(0);
      expect(res.body.details.length).toBeGreaterThan(0);
      expect(res.body.totals.total).toBe(1210);
      expect(res.body.totals.tax).toBe(210);
      expect(res.body.totals.netAmount).toBe(1000);
    });
  });

  describe("GET /api/reports/iva-sales", () => {
    it("debe retornar reporte vacío cuando no hay ventas → 200", async () => {
      const res = await request(app)
        .get("/api/reports/iva-sales")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.periods).toEqual([]);
      expect(res.body.details).toEqual([]);
      expect(res.body.totals.netAmount).toBe(0);
      expect(res.body.totals.tax).toBe(0);
      expect(res.body.totals.total).toBe(0);
    });

    it("debe retornar ventas con IVA computado → 200", async () => {
      // Crear producto
      const productRes = await request(app)
        .post("/api/products")
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Producto Venta", price: 1210, stock: 10 });
      expect(productRes.status).toBe(201);

      // Crear cliente
      const clientRes = await request(app)
        .post("/api/clients")
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "Cliente Venta",
          phone: "5491111111111",
          taxId: "20-11111111-1",
        });
      expect(clientRes.status).toBe(201);

      // Crear orden pagada
      const orderRes = await request(app)
        .post("/api/orders")
        .set("Authorization", `Bearer ${token}`)
        .send({
          client: clientRes.body._id,
          items: [
            {
              product: "Producto Venta",
              productId: productRes.body._id,
              quantity: 1,
              price: 1210,
            },
          ],
          totalAmount: 1210,
          salesStatus: "Confirmada",
          paymentStatus: "Pagado",
          deliveryStatus: "Entregada",
        });
      expect(orderRes.status).toBe(201);

      // Obtener reporte de IVA ventas
      const res = await request(app)
        .get("/api/reports/iva-sales")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.periods.length).toBeGreaterThan(0);
      expect(res.body.details.length).toBeGreaterThan(0);
      expect(res.body.totals.total).toBe(1210);
      // Tax rate default 21% → tax ≈ 210, netAmount ≈ 1000
      expect(res.body.totals.tax).toBeGreaterThan(0);
      expect(res.body.totals.netAmount).toBeGreaterThan(0);
    });
  });

  describe("GET /api/reports/iva-purchases?from=...&to=...", () => {
    it("debe filtrar por rango de fechas → 200", async () => {
      const res = await request(app)
        .get("/api/reports/iva-purchases?from=2020-01-01&to=2020-01-31")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.dateRange.from).toBe("2020-01-01");
      expect(res.body.dateRange.to).toBe("2020-01-31");
    });
  });

  describe("GET /api/reports/iva-sales?from=...&to=...", () => {
    it("debe filtrar por rango de fechas → 200", async () => {
      const res = await request(app)
        .get("/api/reports/iva-sales?from=2020-01-01&to=2020-01-31")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.dateRange.from).toBe("2020-01-01");
      expect(res.body.dateRange.to).toBe("2020-01-31");
    });
  });
});
