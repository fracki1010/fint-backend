const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

const {
  getTenantPlan,
  activateComplements,
} = require("../../../src/controllers/tenantController");
const Tenant = require("../../../src/models/tenant.model");
const User = require("../../../src/models/user.model");
const { Product } = require("../../../src/models/product.model");
const Order = require("../../../src/models/order.model");

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

describe("tenantController - getTenantPlan", () => {
  it("returns complements, enabledFeatures, and availableComplements for app_base tenant", async () => {
    const tenant = await Tenant.create({
      name: "Test Tenant",
      plan: "app_base",
      complements: [],
      enabledFeatures: ["client_account", "supplier_account", "quotes", "banking"],
    });

    const req = { user: { tenant: tenant._id } };
    const res = mockRes();
    await getTenantPlan(req, res);

    expect(res.status).not.toHaveBeenCalled(); // default 200
    const response = res.json.mock.calls[0][0];
    expect(response.success).toBe(true);
    expect(response.plan.current).toBe("app_base");
    expect(response.plan.complements).toEqual([]);
    expect(response.plan.enabledFeatures).toContain("client_account");
    expect(response.plan.enabledFeatures).toContain("supplier_account");
    expect(response.plan.limits).toBeDefined();
    expect(response.plan.limits.maxUsers).toBe(1);
    expect(response.plan.limits.maxProducts).toBe(200);
    expect(response.availableComplements).toBeDefined();
    expect(response.availableComplements.length).toBeGreaterThan(0);
    expect(response.availableComplements[0]).toHaveProperty("id");
    expect(response.availableComplements[0]).toHaveProperty("name");
    expect(response.availableComplements[0]).toHaveProperty("price");
  });

  it("derives limits from active complements (expansion overrides maxProducts)", async () => {
    const tenant = await Tenant.create({
      name: "Test Tenant",
      plan: "app_base",
      complements: ["expansion"],
      enabledFeatures: ["client_account", "unlimited_products", "unlimited_orders"],
    });

    const req = { user: { tenant: tenant._id } };
    const res = mockRes();
    await getTenantPlan(req, res);

    const response = res.json.mock.calls[0][0];
    expect(response.plan.limits.maxProducts).toBe(-1); // serialized Infinity
    expect(response.plan.limits.maxOrdersPerMonth).toBe(-1);
    expect(response.plan.enabledFeatures).toContain("unlimited_products");
  });

  it("derives team limit from team_10 complement", async () => {
    const tenant = await Tenant.create({
      name: "Test Tenant",
      plan: "app_base",
      complements: ["team_10"],
      enabledFeatures: ["client_account", "team_management"],
    });

    const req = { user: { tenant: tenant._id } };
    const res = mockRes();
    await getTenantPlan(req, res);

    const response = res.json.mock.calls[0][0];
    expect(response.plan.limits.maxUsers).toBe(10);
    expect(response.plan.enabledFeatures).toContain("team_management");
  });
});

describe("tenantController - activateComplements", () => {
  it("updates tenant complements, limits, and enabledFeatures", async () => {
    const tenant = await Tenant.create({
      name: "Test Tenant",
      plan: "app_base",
      complements: [],
      enabledFeatures: ["client_account", "supplier_account", "quotes", "banking"],
    });

    const req = {
      user: { tenant: tenant._id },
      body: { complements: ["team_10", "expansion"] },
    };
    const res = mockRes();
    await activateComplements(req, res);

    expect(res.status).not.toHaveBeenCalled();
    const response = res.json.mock.calls[0][0];
    expect(response.success).toBe(true);
    expect(response.plan.current).toBe("app_base");
    expect(response.plan.enabledFeatures).toContain("team_management");
    expect(response.plan.enabledFeatures).toContain("unlimited_products");
    expect(response.plan.limits.maxUsers).toBe(10);
    expect(response.plan.limits.maxProducts).toBe(-1);
  });

  it("rejects invalid complement IDs", async () => {
    const tenant = await Tenant.create({
      name: "Test Tenant",
      plan: "app_base",
      complements: [],
      enabledFeatures: [],
    });

    const req = {
      user: { tenant: tenant._id },
      body: { complements: ["invalid_complement"] },
    };
    const res = mockRes();
    await activateComplements(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    const response = res.json.mock.calls[0][0];
    expect(response.success).toBe(false);
  });

  it("allows empty complements (app_base only)", async () => {
    const tenant = await Tenant.create({
      name: "Test Tenant",
      plan: "app_base",
      complements: ["expansion"],
      enabledFeatures: ["unlimited_products"],
    });

    const req = {
      user: { tenant: tenant._id },
      body: { complements: [] },
    };
    const res = mockRes();
    await activateComplements(req, res);

    const response = res.json.mock.calls[0][0];
    expect(response.success).toBe(true);
    expect(response.plan.enabledFeatures).not.toContain("unlimited_products");
    expect(response.plan.limits.maxProducts).toBe(200);
  });
});
