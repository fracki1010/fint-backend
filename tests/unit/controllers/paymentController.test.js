const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

const {
  createPreference,
  processApprovedPayment,
} = require("../../../src/controllers/paymentController");
const Tenant = require("../../../src/models/tenant.model");
const PaymentRecord = require("../../../src/models/payment.model");

let mongoServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongoServer.getUri());
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

const mockRes = () => {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  res.setHeader = vi.fn().mockReturnValue(res);
  res.locals = { requestId: "test-req-id" };
  return res;
};

describe("paymentController - createPreference", () => {
  it("rejects when no complements array is provided", async () => {
    const tenant = await Tenant.create({ name: "Test Tenant", plan: "app_base" });
    const req = {
      user: { tenant: tenant._id, email: "test@test.com" },
      body: {},
    };
    const res = mockRes();
    await createPreference(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    const response = res.json.mock.calls[0][0];
    expect(response.error.code).toBe("INVALID_PLAN");
  });

  it("rejects when invalid complement ID is provided", async () => {
    const tenant = await Tenant.create({ name: "Test Tenant", plan: "app_base" });
    const req = {
      user: { tenant: tenant._id, email: "test@test.com" },
      body: { complements: ["invalid_id"] },
    };
    const res = mockRes();
    await createPreference(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    const response = res.json.mock.calls[0][0];
    expect(response.error.code).toBe("INVALID_PLAN");
  });
});

describe("paymentController - processApprovedPayment", () => {
  it("parses external_reference with complements and updates tenant", async () => {
    const tenant = await Tenant.create({
      name: "Test Tenant",
      plan: "app_base",
      complements: [],
      enabledFeatures: ["client_account", "supplier_account", "quotes", "banking"],
      status: "active",
    });

    const paymentData = {
      id: "12345",
      external_reference: JSON.stringify({
        tenantId: tenant._id.toString(),
        complements: ["team_10"],
        totalPrice: 300,
      }),
      transaction_amount: 300,
      currency_id: "ARS",
      payment_method_id: "visa",
      preference_id: "pref_123",
      payer: { email: "test@test.com" },
      status: "approved",
    };

    await processApprovedPayment(paymentData);

    const updatedTenant = await Tenant.findById(tenant._id).lean();
    expect(updatedTenant.complements).toContain("team_10");
    expect(updatedTenant.enabledFeatures).toContain("team_management");

    const paymentRecord = await PaymentRecord.findOne({ mercadoPagoPaymentId: "12345" }).lean();
    expect(paymentRecord).toBeTruthy();
    expect(paymentRecord.complements).toEqual(["team_10"]);
    expect(paymentRecord.totalPrice).toBe(300);
    expect(paymentRecord.status).toBe("approved");
  });

  it("handles empty complements array in external_reference", async () => {
    const tenant = await Tenant.create({
      name: "Test Tenant",
      plan: "app_base",
      complements: ["expansion"],
      enabledFeatures: ["client_account", "unlimited_products"],
      status: "active",
    });

    const paymentData = {
      id: "67890",
      external_reference: JSON.stringify({
        tenantId: tenant._id.toString(),
        complements: [],
        totalPrice: 200,
      }),
      transaction_amount: 200,
      currency_id: "ARS",
      payment_method_id: "visa",
      preference_id: "pref_456",
      payer: { email: "test@test.com" },
      status: "approved",
    };

    await processApprovedPayment(paymentData);

    const updatedTenant = await Tenant.findById(tenant._id).lean();
    expect(updatedTenant.complements).toEqual([]);
    expect(updatedTenant.enabledFeatures).not.toContain("unlimited_products");
  });

  it("skips when external_reference is missing", async () => {
    const paymentData = {
      id: "99999",
      status: "approved",
    };

    // Should not throw
    await expect(processApprovedPayment(paymentData)).resolves.toBeUndefined();
  });

  it("skips when tenantId is missing from external_reference", async () => {
    const paymentData = {
      id: "11111",
      external_reference: JSON.stringify({ complements: ["team_10"] }),
      status: "approved",
    };

    await expect(processApprovedPayment(paymentData)).resolves.toBeUndefined();
  });
});
