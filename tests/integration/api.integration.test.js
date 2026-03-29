const mongoose = require("mongoose");
const request = require("supertest");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test_jwt_secret_123";
process.env.ADMIN_SETUP_KEY = "test_setup_key_123";
process.env.AUTH_BOOTSTRAP_ENABLED = "true";
process.env.CORS_ORIGINS = "http://localhost:5173";

const { createApp } = require("../../src/app");
const { Product } = require("../../src/models/product.model");
const Order = require("../../src/models/order.model");

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

describe("API integration", () => {
  it("deshabilita bootstrap-superadmin en produccion", async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "production";

      const response = await request(app)
        .post("/api/auth/bootstrap-superadmin")
        .send(bootstrapPayload);

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe("NOT_FOUND");
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
    }
  });

  it("autentica usuario y devuelve error estándar en credenciales inválidas", async () => {
    await bootstrapAndGetToken();

    const loginResponse = await request(app).post("/api/auth/login").send({
      email: bootstrapPayload.email,
      password: bootstrapPayload.password,
    });

    expect(loginResponse.status).toBe(200);
    expect(loginResponse.body.token).toBeTruthy();

    const invalidLoginResponse = await request(app).post("/api/auth/login").send({
      email: bootstrapPayload.email,
      password: "bad-password",
    });

    expect(invalidLoginResponse.status).toBe(401);
    expect(invalidLoginResponse.body.error.code).toBe("INVALID_CREDENTIALS");
  });

  it("descuenta stock en venta entregada y revierte al cancelar orden", async () => {
    const token = await bootstrapAndGetToken();

    const clientResponse = await request(app)
      .post("/api/clients")
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: "Cliente Test",
        phone: "5491111111111",
        taxId: "20-11111111-1",
      });
    expect(clientResponse.status).toBe(201);

    const productResponse = await request(app)
      .post("/api/products")
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: "Producto Test",
        price: 100,
        stock: 10,
      });
    expect(productResponse.status).toBe(201);
    const productId = productResponse.body._id;

    const orderResponse = await request(app)
      .post("/api/orders")
      .set("Authorization", `Bearer ${token}`)
      .send({
        client: clientResponse.body._id,
        items: [
          {
            product: "Producto Test",
            productId,
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
    const orderId = orderResponse.body._id;

    const productAfterSale = await Product.findById(productId).lean();
    expect(productAfterSale.stock).toBe(8);

    const cancelResponse = await request(app)
      .delete(`/api/orders/${orderId}`)
      .set("Authorization", `Bearer ${token}`);

    expect(cancelResponse.status).toBe(200);

    const productAfterCancel = await Product.findById(productId).lean();
    expect(productAfterCancel.stock).toBe(10);

    const orderAfterCancel = await Order.findById(orderId).lean();
    expect(orderAfterCancel.salesStatus).toBe("Cancelada");
    expect(orderAfterCancel.stockApplied).toBe(false);
  });

  it("bloquea salida manual de stock cuando no hay disponibilidad", async () => {
    const token = await bootstrapAndGetToken();

    const productResponse = await request(app)
      .post("/api/products")
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: "Producto Stock Minimo",
        price: 50,
        stock: 1,
      });
    expect(productResponse.status).toBe(201);

    const movementResponse = await request(app)
      .post("/api/stock-movements")
      .set("Authorization", `Bearer ${token}`)
      .send({
        product: productResponse.body._id,
        type: "SALIDA",
        quantity: 2,
        reason: "Prueba de stock",
      });

    expect(movementResponse.status).toBe(409);
    expect(movementResponse.body.error.code).toBe("INSUFFICIENT_STOCK");
  });

  it("rechaza payload inválido con VALIDATION_ERROR", async () => {
    const token = await bootstrapAndGetToken();

    const invalidProductResponse = await request(app)
      .post("/api/products")
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: "",
        price: -1,
      });

    expect(invalidProductResponse.status).toBe(400);
    expect(invalidProductResponse.body.error.code).toBe("VALIDATION_ERROR");
    expect(Array.isArray(invalidProductResponse.body.error.details)).toBe(true);
  });

  it("aplica rate limit en login", async () => {
    await bootstrapAndGetToken();

    let lastResponse = null;
    for (let attempt = 0; attempt < 11; attempt += 1) {
      lastResponse = await request(app).post("/api/auth/login").send({
        email: "rate-limit-test@test.local",
        password: "wrong-password",
      });
    }

    expect(lastResponse.status).toBe(429);
    expect(lastResponse.body.error.code).toBe("RATE_LIMIT_EXCEEDED");
  });
});
