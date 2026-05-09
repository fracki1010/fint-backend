/**
 * @fileoverview Integration tests for Banking Reconciliation API endpoints
 * Tests accounts, transactions, CSV import, match, and confirm reconciliation.
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

describe("Banking Reconciliation API", () => {
  let token;

  beforeEach(async () => {
    token = await bootstrapAndGetToken();
  });

  describe("POST /api/banking/accounts", () => {
    it("debería crear una cuenta bancaria", async () => {
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
  });

  describe("GET /api/banking/accounts", () => {
    it("debería listar cuentas bancarias", async () => {
      await request(app)
        .post("/api/banking/accounts")
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "Cuenta A",
          bank: "Banco A",
          accountNumber: "111-111111/1",
        });

      const response = await request(app)
        .get("/api/banking/accounts")
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].name).toBe("Cuenta A");
    });
  });

  describe("POST /api/banking/transactions", () => {
    let accountId;

    beforeEach(async () => {
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

    it("debería crear una transacción", async () => {
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
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.type).toBe("debit");
      expect(response.body.data.amount).toBe(5000);
      expect(response.body.data.status).toBe("pending");
      expect(response.body.data.bankAccount).toBe(accountId);
    });
  });

  describe("GET /api/banking/transactions", () => {
    let accountId;

    beforeEach(async () => {
      const accountRes = await request(app)
        .post("/api/banking/accounts")
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "Filter Account",
          bank: "Banco Filter",
          accountNumber: "666-666666/6",
        });
      accountId = accountRes.body.data._id;

      // Create two transactions
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
    });

    it("debería listar transacciones con filtros", async () => {
      const response = await request(app)
        .get("/api/banking/transactions")
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(2);
    });

    it("debería filtrar por tipo", async () => {
      const response = await request(app)
        .get("/api/banking/transactions?type=credit")
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].type).toBe("credit");
    });
  });

  describe("POST /api/banking/accounts/:id/import", () => {
    let accountId;

    beforeEach(async () => {
      const accountRes = await request(app)
        .post("/api/banking/accounts")
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "Import Account",
          bank: "Banco Import",
          accountNumber: "777-777777/7",
        });
      accountId = accountRes.body.data._id;
    });

    it("debería importar transacciones desde CSV", async () => {
      const csvBuffer = Buffer.from(
        "Fecha,Concepto,Importe\n2026-05-01,Pago cliente,5000\n2026-05-02,Pago proveedor,-2000",
      );

      const response = await request(app)
        .post(`/api/banking/accounts/${accountId}/import`)
        .set("Authorization", `Bearer ${token}`)
        .attach("file", csvBuffer, "transactions.csv");

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.created).toBe(2);
      expect(response.body.data.totalRows).toBe(2);
    });
  });

  describe("Full Reconciliation Flow", () => {
    let accountId;
    let transactionId;

    beforeEach(async () => {
      // Create bank account
      const accountRes = await request(app)
        .post("/api/banking/accounts")
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "Reconciliation Account",
          bank: "Banco Recon",
          accountNumber: "888-888888/8",
          currentBalance: 50000,
        });
      accountId = accountRes.body.data._id;

      // Create a transaction to reconcile
      const txRes = await request(app)
        .post("/api/banking/transactions")
        .set("Authorization", `Bearer ${token}`)
        .send({
          bankAccount: accountId,
          date: "2026-05-01",
          description: "Pago a proveedor",
          amount: 10000,
          type: "debit",
        });
      transactionId = txRes.body.data._id;
    });

    it("debería obtener datos de conciliación", async () => {
      const response = await request(app)
        .get(`/api/banking/accounts/${accountId}/reconciliation`)
        .set("Authorization", `Bearer ${token}`)
        .query({ dateFrom: "2026-04-01", dateTo: "2026-06-01" });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.bankTransactions).toBeDefined();
      expect(response.body.data.bankTransactions).toHaveLength(1);
      expect(response.body.data.balance).toBeDefined();
      expect(response.body.data.balance.current).toBe(50000);
    });

    it("debería conciliar una transacción", async () => {
      const matchId = new mongoose.Types.ObjectId();

      const response = await request(app)
        .put(`/api/banking/transactions/${transactionId}/match`)
        .set("Authorization", `Bearer ${token}`)
        .send({
          matchedEntryType: "Order",
          matchedEntryId: matchId,
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.status).toBe("reconciled");
      expect(response.body.data.matchedEntryType).toBe("Order");
      expect(response.body.data.matchedEntryId).toBe(matchId.toString());
    });

    it("debería confirmar la conciliación", async () => {
      // First match the transaction
      const matchId = new mongoose.Types.ObjectId();
      await request(app)
        .put(`/api/banking/transactions/${transactionId}/match`)
        .set("Authorization", `Bearer ${token}`)
        .send({
          matchedEntryType: "Order",
          matchedEntryId: matchId,
        });

      // Then confirm reconciliation
      const response = await request(app)
        .post(`/api/banking/accounts/${accountId}/confirm-reconciliation`)
        .set("Authorization", `Bearer ${token}`)
        .send({
          endDate: "2026-05-31",
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.reconciledCount).toBe(1);
      expect(response.body.data.currentBalance).toBeDefined();
      // Initial 50000 - 10000 debit = 40000
      expect(response.body.data.currentBalance).toBe(40000);
      expect(response.body.data.netChange).toBe(-10000);
    });
  });
});
