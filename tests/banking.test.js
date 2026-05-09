/**
 * @fileoverview Integration tests for Banking API endpoints
 * Tests bank account CRUD and transaction creation/listing.
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
const BankAccount = require("../src/models/bankAccount.model");
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

describe("Banking API", () => {
  let token;
  let accountId;

  describe("POST /api/banking/accounts", () => {
    beforeEach(async () => {
      token = await bootstrapAndGetToken();
    });

    it("should create a bank account", async () => {
      const response = await request(app)
        .post("/api/banking/accounts")
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "Cuenta Corriente",
          bank: "Banco Test",
          accountNumber: "123-456789/0",
          type: "checking",
          currency: "ARS",
          currentBalance: 10000,
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.name).toBe("Cuenta Corriente");
      expect(response.body.data.bank).toBe("Banco Test");
      expect(response.body.data.accountNumber).toBe("123-456789/0");
      expect(response.body.data.type).toBe("checking");
      expect(response.body.data.currentBalance).toBe(10000);
      expect(response.body.data.isActive).toBe(true);
    });

    it("should create account with defaults", async () => {
      const response = await request(app)
        .post("/api/banking/accounts")
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "Cuenta Simple",
          bank: "Otro Banco",
          accountNumber: "987-654321/0",
        });

      expect(response.status).toBe(201);
      expect(response.body.data.type).toBe("checking");
      expect(response.body.data.currency).toBe("ARS");
      expect(response.body.data.currentBalance).toBe(0);
      expect(response.body.data.isActive).toBe(true);
    });

    it("should return 400 when name is missing", async () => {
      const response = await request(app)
        .post("/api/banking/accounts")
        .set("Authorization", `Bearer ${token}`)
        .send({
          bank: "Banco Test",
          accountNumber: "123-456789/0",
        });

      expect(response.status).toBe(400);
    });

    it("should require authentication", async () => {
      const response = await request(app)
        .post("/api/banking/accounts")
        .send({
          name: "Cuenta Sin Auth",
          bank: "Banco",
          accountNumber: "000-000000/0",
        });

      expect(response.status).toBe(401);
    });
  });

  describe("GET /api/banking/accounts", () => {
    beforeEach(async () => {
      token = await bootstrapAndGetToken();
    });

    it("should list bank accounts", async () => {
      // Create two accounts
      await request(app)
        .post("/api/banking/accounts")
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "Cuenta A",
          bank: "Banco A",
          accountNumber: "111-111111/1",
        });

      await request(app)
        .post("/api/banking/accounts")
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "Cuenta B",
          bank: "Banco B",
          accountNumber: "222-222222/2",
        });

      const response = await request(app)
        .get("/api/banking/accounts")
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(2);
    });

    it("should return empty list when no accounts exist", async () => {
      const response = await request(app)
        .get("/api/banking/accounts")
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.data).toEqual([]);
    });

    it("should exclude inactive accounts by default", async () => {
      // Create active account
      await request(app)
        .post("/api/banking/accounts")
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "Active Account",
          bank: "Banco",
          accountNumber: "333-333333/3",
          isActive: true,
        });

      // Create inactive account directly
      const settings = await Setting.findOne({});
      await BankAccount.create({
        tenant: settings.tenant,
        name: "Inactive Account",
        bank: "Banco",
        accountNumber: "444-444444/4",
        isActive: false,
      });

      const response = await request(app)
        .get("/api/banking/accounts")
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].name).toBe("Active Account");
    });
  });

  describe("POST /api/banking/transactions", () => {
    beforeEach(async () => {
      token = await bootstrapAndGetToken();

      // Create a bank account for transactions
      const accountRes = await request(app)
        .post("/api/banking/accounts")
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "Transaction Account",
          bank: "Banco Test",
          accountNumber: "555-555555/5",
        });
      accountId = accountRes.body.data._id;
    });

    it("should create a debit transaction", async () => {
      const response = await request(app)
        .post("/api/banking/transactions")
        .set("Authorization", `Bearer ${token}`)
        .send({
          bankAccount: accountId,
          date: "2026-05-09",
          description: "Pago a proveedor",
          amount: 5000,
          type: "debit",
          reference: "REF-001",
          notes: "Factura de servicios",
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.type).toBe("debit");
      expect(response.body.data.amount).toBe(5000);
      expect(response.body.data.description).toBe("Pago a proveedor");
      expect(response.body.data.reference).toBe("REF-001");
      expect(response.body.data.status).toBe("pending");
      expect(response.body.data.bankAccount).toBe(accountId);
    });

    it("should create a credit transaction", async () => {
      const response = await request(app)
        .post("/api/banking/transactions")
        .set("Authorization", `Bearer ${token}`)
        .send({
          bankAccount: accountId,
          date: "2026-05-09",
          description: "Depósito recibido",
          amount: 10000,
          type: "credit",
        });

      expect(response.status).toBe(201);
      expect(response.body.data.type).toBe("credit");
      expect(response.body.data.amount).toBe(10000);
    });

    it("should return 404 when bank account does not exist", async () => {
      const fakeId = new mongoose.Types.ObjectId();
      const response = await request(app)
        .post("/api/banking/transactions")
        .set("Authorization", `Bearer ${token}`)
        .send({
          bankAccount: fakeId,
          date: "2026-05-09",
          description: "Test",
          amount: 100,
          type: "credit",
        });

      expect(response.status).toBe(404);
    });

    it("should return 400 when amount is zero", async () => {
      const response = await request(app)
        .post("/api/banking/transactions")
        .set("Authorization", `Bearer ${token}`)
        .send({
          bankAccount: accountId,
          date: "2026-05-09",
          description: "Zero amount",
          amount: 0,
          type: "credit",
        });

      expect(response.status).toBe(400);
    });

    it("should require authentication", async () => {
      const response = await request(app)
        .post("/api/banking/transactions")
        .send({
          bankAccount: accountId,
          date: "2026-05-09",
          description: "Test",
          amount: 100,
          type: "credit",
        });

      expect(response.status).toBe(401);
    });
  });

  describe("GET /api/banking/transactions", () => {
    beforeEach(async () => {
      token = await bootstrapAndGetToken();

      // Create a bank account
      const accountRes = await request(app)
        .post("/api/banking/accounts")
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "Filter Account",
          bank: "Banco Filter",
          accountNumber: "666-666666/6",
        });
      accountId = accountRes.body.data._id;

      // Create multiple transactions
      await request(app)
        .post("/api/banking/transactions")
        .set("Authorization", `Bearer ${token}`)
        .send({
          bankAccount: accountId,
          date: "2026-05-01",
          description: "Depósito mayo",
          amount: 5000,
          type: "credit",
        });

      await request(app)
        .post("/api/banking/transactions")
        .set("Authorization", `Bearer ${token}`)
        .send({
          bankAccount: accountId,
          date: "2026-05-15",
          description: "Pago servicios",
          amount: 2000,
          type: "debit",
        });

      await request(app)
        .post("/api/banking/transactions")
        .set("Authorization", `Bearer ${token}`)
        .send({
          bankAccount: accountId,
          date: "2026-05-20",
          description: "Otro depósito",
          amount: 3000,
          type: "credit",
        });
    });

    it("should list all transactions", async () => {
      const response = await request(app)
        .get("/api/banking/transactions")
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(3);
    });

    it("should filter by type", async () => {
      const response = await request(app)
        .get("/api/banking/transactions?type=credit")
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(2);
      expect(response.body.data.every((t) => t.type === "credit")).toBe(true);
    });

    it("should filter by date range", async () => {
      const response = await request(app)
        .get("/api/banking/transactions?dateFrom=2026-05-10&dateTo=2026-05-18")
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].description).toBe("Pago servicios");
    });

    it("should filter by bank account", async () => {
      const response = await request(app)
        .get(`/api/banking/transactions?bankAccount=${accountId}`)
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(3);
    });

    it("should return empty list when no transactions match", async () => {
      const fakeId = new mongoose.Types.ObjectId();
      const response = await request(app)
        .get(`/api/banking/transactions?bankAccount=${fakeId}`)
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.data).toEqual([]);
    });
  });
});
