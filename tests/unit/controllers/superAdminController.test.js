const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

const {
  getAnalytics,
  createTenant,
  updateTenant,
} = require("../../../src/controllers/superAdminController");
const Tenant = require("../../../src/models/tenant.model");
const User = require("../../../src/models/user.model");
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

describe("superAdminController - getAnalytics", () => {
  it("computes MRR from complement aggregation", async () => {
    // Create tenants with different complement sets
    await Tenant.create({ name: "T1", plan: "app_base", complements: [], status: "active" });
    await Tenant.create({ name: "T2", plan: "app_base", complements: ["team_10"], status: "active" });
    await Tenant.create({ name: "T3", plan: "app_base", complements: ["expansion", "team_10"], status: "active" });

    const req = {};
    const res = mockRes();
    await getAnalytics(req, res);

    const response = res.json.mock.calls[0][0];
    expect(response.success).toBe(true);
    // APP_BASE = 200, team_10 = 100, expansion = 100
    // T1: 200, T2: 300, T3: 400 => total MRR = 900
    expect(response.analytics.revenue.mrr).toBe(900);
    expect(response.analytics.revenue.arr).toBe(10800);
  });

  it("includes only active tenants in MRR", async () => {
    await Tenant.create({ name: "Active", plan: "app_base", complements: ["api"], status: "active" });
    await Tenant.create({ name: "Suspended", plan: "app_base", complements: ["api"], status: "suspended" });

    const req = {};
    const res = mockRes();
    await getAnalytics(req, res);

    const response = res.json.mock.calls[0][0];
    // Only active: 200 + 100 = 300
    expect(response.analytics.revenue.mrr).toBe(300);
  });
});

describe("superAdminController - createTenant", () => {
  it("defaults to app_base plan with empty complements", async () => {
    const req = {
      user: { _id: new mongoose.Types.ObjectId() },
      body: {
        businessName: "Test Business",
        adminEmail: "admin@test.com",
        adminName: "Admin User",
      },
      ip: "127.0.0.1",
      headers: { "user-agent": "test" },
    };
    const res = mockRes();
    await createTenant(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    const response = res.json.mock.calls[0][0];
    expect(response.success).toBe(true);
    expect(response.tenant.plan).toBe("app_base");
    expect(response.tenant.complements).toEqual([]);
    expect(response.tenant.enabledFeatures).toContain("client_account");
    expect(response.tenant.limits.maxUsers).toBe(1);
    expect(response.tenant.limits.maxProducts).toBe(200);
  });
});

describe("superAdminController - updateTenant", () => {
  it("updates tenant complements and derives limits/features", async () => {
    const tenant = await Tenant.create({
      name: "Test Tenant",
      plan: "app_base",
      complements: [],
      enabledFeatures: ["client_account"],
      limits: { maxUsers: 1, maxProducts: 200, maxOrdersPerMonth: 500 },
    });

    const req = {
      user: { _id: new mongoose.Types.ObjectId() },
      params: { id: tenant._id.toString() },
      body: {
        complements: ["team_10", "expansion"],
      },
      ip: "127.0.0.1",
      headers: { "user-agent": "test" },
    };
    const res = mockRes();
    await updateTenant(req, res);

    const response = res.json.mock.calls[0][0];
    expect(response.success).toBe(true);
    expect(response.tenant.complements).toEqual(["team_10", "expansion"]);
    expect(response.tenant.enabledFeatures).toContain("team_management");
    expect(response.tenant.limits.maxUsers).toBe(10);
  });
});
