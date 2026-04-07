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
const StockMovement = require("../../src/models/stockMovement.model");

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

describe("API integration", () => {
  it("incluye X-Request-Id en respuestas", async () => {
    const response = await request(app).get("/api/health");
    expect(response.status).toBe(200);
    expect(response.headers["x-request-id"]).toBeTruthy();
  });

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
    expect(invalidLoginResponse.body.requestId).toBeTruthy();
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
        costPrice: 35,
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
    expect(orderResponse.body.items?.[0]?.unitCostAtSale).toBe(35);

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

  it("evita crear orden duplicada cuando se reintenta con el mismo Idempotency-Key", async () => {
    const token = await bootstrapAndGetToken();

    const clientResponse = await request(app)
      .post("/api/clients")
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: "Cliente Idempotencia",
        phone: "5491111111122",
        taxId: "20-22222222-2",
      });
    expect(clientResponse.status).toBe(201);

    const productResponse = await request(app)
      .post("/api/products")
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: "Producto Idempotencia Create",
        price: 25,
        stock: 20,
      });
    expect(productResponse.status).toBe(201);

    const key = "idem-create-order-001";
    const payload = {
      client: clientResponse.body._id,
      items: [
        {
          product: "Producto Idempotencia Create",
          productId: productResponse.body._id,
          quantity: 2,
          price: 25,
        },
      ],
      totalAmount: 50,
      salesStatus: "Confirmada",
      paymentStatus: "Pagado",
      deliveryStatus: "Entregada",
    };

    const first = await request(app)
      .post("/api/orders")
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", key)
      .send(payload);

    const second = await request(app)
      .post("/api/orders")
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", key)
      .send(payload);

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.headers["idempotent-replayed"]).toBe("true");
    expect(first.body._id).toBe(second.body._id);

    const totalOrders = await Order.countDocuments({});
    expect(totalOrders).toBe(1);
  });

  it("evita reaplicar update de orden cuando se reintenta con el mismo Idempotency-Key", async () => {
    const token = await bootstrapAndGetToken();

    const clientResponse = await request(app)
      .post("/api/clients")
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: "Cliente Idempotencia Update",
        phone: "5491111111133",
        taxId: "20-33333333-3",
      });
    expect(clientResponse.status).toBe(201);

    const productResponse = await request(app)
      .post("/api/products")
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: "Producto Idempotencia Update",
        price: 30,
        stock: 15,
      });
    expect(productResponse.status).toBe(201);

    const createOrderResponse = await request(app)
      .post("/api/orders")
      .set("Authorization", `Bearer ${token}`)
      .send({
        client: clientResponse.body._id,
        items: [
          {
            product: "Producto Idempotencia Update",
            productId: productResponse.body._id,
            quantity: 1,
            price: 30,
          },
        ],
        totalAmount: 30,
      });
    expect(createOrderResponse.status).toBe(201);

    const orderId = createOrderResponse.body._id;
    const key = "idem-update-order-001";
    const updatePayload = { notes: "nota idempotente" };

    const firstUpdate = await request(app)
      .put(`/api/orders/${orderId}`)
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", key)
      .send(updatePayload);

    const secondUpdate = await request(app)
      .put(`/api/orders/${orderId}`)
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", key)
      .send(updatePayload);

    expect(firstUpdate.status).toBe(200);
    expect(secondUpdate.status).toBe(200);
    expect(secondUpdate.headers["idempotent-replayed"]).toBe("true");
    expect(firstUpdate.body._id).toBe(secondUpdate.body._id);
    expect(secondUpdate.body.notes).toBe("nota idempotente");
  });

  it("evita recancelar orden y duplicar reversion de stock con el mismo Idempotency-Key", async () => {
    const token = await bootstrapAndGetToken();

    const clientResponse = await request(app)
      .post("/api/clients")
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: "Cliente Idempotencia Delete",
        phone: "5491111111144",
        taxId: "20-44444444-4",
      });
    expect(clientResponse.status).toBe(201);

    const productResponse = await request(app)
      .post("/api/products")
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: "Producto Idempotencia Delete",
        price: 40,
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
            product: "Producto Idempotencia Delete",
            productId,
            quantity: 2,
            price: 40,
          },
        ],
        totalAmount: 80,
        salesStatus: "Confirmada",
        paymentStatus: "Pagado",
        deliveryStatus: "Entregada",
      });
    expect(orderResponse.status).toBe(201);
    const orderId = orderResponse.body._id;

    const key = "idem-delete-order-001";
    const firstDelete = await request(app)
      .delete(`/api/orders/${orderId}`)
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", key);

    const secondDelete = await request(app)
      .delete(`/api/orders/${orderId}`)
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", key);

    expect(firstDelete.status).toBe(200);
    expect(secondDelete.status).toBe(200);
    expect(secondDelete.headers["idempotent-replayed"]).toBe("true");

    const productAfter = await Product.findById(productId).lean();
    expect(productAfter.stock).toBe(10);

    const orderAfter = await Order.findById(orderId).lean();
    expect(orderAfter.salesStatus).toBe("Cancelada");
    expect(orderAfter.stockApplied).toBe(false);
  });

  it("evita duplicar movimiento manual de stock con el mismo Idempotency-Key", async () => {
    const token = await bootstrapAndGetToken();

    const productResponse = await request(app)
      .post("/api/products")
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: "Producto Idempotencia Movimiento",
        price: 60,
        stock: 5,
      });
    expect(productResponse.status).toBe(201);
    const productId = productResponse.body._id;

    const key = "idem-stock-movement-001";
    const movementPayload = {
      product: productId,
      type: "ENTRADA",
      quantity: 3,
      reason: "Ajuste idempotente",
    };

    const firstMovement = await request(app)
      .post("/api/stock-movements")
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", key)
      .send(movementPayload);

    const secondMovement = await request(app)
      .post("/api/stock-movements")
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", key)
      .send(movementPayload);

    expect(firstMovement.status).toBe(201);
    expect(secondMovement.status).toBe(200);
    expect(secondMovement.headers["idempotent-replayed"]).toBe("true");
    expect(firstMovement.body._id).toBe(secondMovement.body._id);

    const productAfter = await Product.findById(productId).lean();
    expect(productAfter.stock).toBe(8);

    const movementsCount = await StockMovement.countDocuments({
      product: productId,
      tenant: productAfter.tenant,
    });
    expect(movementsCount).toBe(1);
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

  it("protege endpoint de WhatsApp cuando no hay autenticacion", async () => {
    const response = await request(app).get("/api/whatsapp/status");
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("AUTH_REQUIRED");
    expect(response.body.requestId).toBeTruthy();
  });

  it("rechaza token invalido con formato de error estandar", async () => {
    const response = await request(app)
      .get("/api/clients")
      .set("Authorization", "Bearer token-falso");

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("INVALID_TOKEN");
    expect(response.body.requestId).toBeTruthy();
  });

  it("solo superadmin puede crear usuarios", async () => {
    const superToken = await bootstrapAndGetToken();

    const createUserResponse = await request(app)
      .post("/api/auth/users")
      .set("Authorization", `Bearer ${superToken}`)
      .send({
        fullName: "Operador QA",
        email: "operador-qa@test.local",
        password: "secret123",
        storeName: "Sucursal QA",
      });
    expect(createUserResponse.status).toBe(201);

    const operatorLogin = await request(app).post("/api/auth/login").send({
      email: "operador-qa@test.local",
      password: "secret123",
    });
    expect(operatorLogin.status).toBe(200);

    const forbiddenCreate = await request(app)
      .post("/api/auth/users")
      .set("Authorization", `Bearer ${operatorLogin.body.token}`)
      .send({
        fullName: "No Permitido",
        email: "no-permitido@test.local",
        password: "secret123",
        storeName: "No Permitido",
      });

    expect(forbiddenCreate.status).toBe(403);
    expect(forbiddenCreate.body.error.code).toBe("FORBIDDEN");
  });

  it("bloquea entrega sin pago cuando la politica no lo permite", async () => {
    const token = await bootstrapAndGetToken();

    const clientResponse = await request(app)
      .post("/api/clients")
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: "Cliente Politica Pago",
        phone: "5491111111155",
        taxId: "20-55555555-5",
      });
    expect(clientResponse.status).toBe(201);

    const productResponse = await request(app)
      .post("/api/products")
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: "Producto Politica Pago",
        price: 70,
        stock: 12,
      });
    expect(productResponse.status).toBe(201);

    const orderResponse = await request(app)
      .post("/api/orders")
      .set("Authorization", `Bearer ${token}`)
      .send({
        client: clientResponse.body._id,
        items: [
          {
            product: "Producto Politica Pago",
            productId: productResponse.body._id,
            quantity: 1,
            price: 70,
          },
        ],
        totalAmount: 70,
      });
    expect(orderResponse.status).toBe(201);

    const updateResponse = await request(app)
      .put(`/api/orders/${orderResponse.body._id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        deliveryStatus: "Entregada",
        paymentStatus: "Pendiente",
      });

    expect(updateResponse.status).toBe(400);
    expect(updateResponse.body.error.code).toBe(
      "DELIVERY_WITHOUT_PAYMENT_NOT_ALLOWED",
    );
  });

  it("permite entrega sin pago cuando la configuracion lo habilita", async () => {
    const token = await bootstrapAndGetToken();

    const settingsUpdate = await request(app)
      .put("/api/settings")
      .set("Authorization", `Bearer ${token}`)
      .send({ allowDeliveryWithoutPayment: true });
    expect(settingsUpdate.status).toBe(200);

    const clientResponse = await request(app)
      .post("/api/clients")
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: "Cliente Politica Flexible",
        phone: "5491111111166",
        taxId: "20-66666666-6",
      });
    expect(clientResponse.status).toBe(201);

    const productResponse = await request(app)
      .post("/api/products")
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: "Producto Politica Flexible",
        price: 80,
        stock: 10,
      });
    expect(productResponse.status).toBe(201);

    const orderResponse = await request(app)
      .post("/api/orders")
      .set("Authorization", `Bearer ${token}`)
      .send({
        client: clientResponse.body._id,
        items: [
          {
            product: "Producto Politica Flexible",
            productId: productResponse.body._id,
            quantity: 1,
            price: 80,
          },
        ],
        totalAmount: 80,
      });
    expect(orderResponse.status).toBe(201);

    const updateResponse = await request(app)
      .put(`/api/orders/${orderResponse.body._id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        deliveryStatus: "Entregada",
        paymentStatus: "Pendiente",
      });

    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body.deliveryStatus).toBe("Entregada");
    expect(updateResponse.body.paymentStatus).toBe("Pendiente");
  });
});
