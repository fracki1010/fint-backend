const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

const { requireFeature, checkLimit } = require("../../../src/middlewares/planMiddleware");
const Tenant = require("../../../src/models/tenant.model");

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
  return res;
};

describe("requireFeature", () => {
  it("allows access when enabledFeatures contains the required feature", async () => {
    const tenant = await Tenant.create({
      name: "Test Tenant",
      plan: "app_base",
      enabledFeatures: ["team_management"],
    });

    const req = { user: { tenant: tenant._id } };
    const res = mockRes();
    const next = vi.fn();

    await requireFeature("team_management")(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("blocks access when enabledFeatures does not contain the required feature", async () => {
    const tenant = await Tenant.create({
      name: "Test Tenant",
      plan: "app_base",
      enabledFeatures: ["client_account"],
    });

    const req = { user: { tenant: tenant._id } };
    const res = mockRes();
    const next = vi.fn();

    await requireFeature("team_management")(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          code: "FEATURE_NOT_AVAILABLE",
        }),
      }),
    );
  });

  it("blocks access when enabledFeatures is empty", async () => {
    const tenant = await Tenant.create({
      name: "Test Tenant",
      plan: "app_base",
      enabledFeatures: [],
    });

    const req = { user: { tenant: tenant._id } };
    const res = mockRes();
    const next = vi.fn();

    await requireFeature("quotes")(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("blocks access when enabledFeatures is undefined", async () => {
    const tenant = await Tenant.create({
      name: "Test Tenant",
      plan: "app_base",
    });

    const req = { user: { tenant: tenant._id } };
    const res = mockRes();
    const next = vi.fn();

    await requireFeature("quotes")(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("returns 403 when tenant is not found", async () => {
    const req = { user: { tenant: new mongoose.Types.ObjectId() } };
    const res = mockRes();
    const next = vi.fn();

    await requireFeature("quotes")(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          code: "TENANT_NOT_FOUND",
        }),
      }),
    );
  });

  it("calls next(err) on unexpected errors", async () => {
    const req = { user: { tenant: "not-an-object-id" } };
    const res = mockRes();
    const next = vi.fn();

    await requireFeature("quotes")(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toBeInstanceOf(Error);
  });

  it("does NOT use FEATURE_MATRIX or plan-based defaults", async () => {
    // A tenant with plan "business" but no enabledFeatures should be blocked
    const tenant = await Tenant.create({
      name: "Test Tenant",
      plan: "business",
      enabledFeatures: [],
    });

    const req = { user: { tenant: tenant._id } };
    const res = mockRes();
    const next = vi.fn();

    await requireFeature("team_management")(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });
});

describe("checkLimit", () => {
  it("allows access when usage is below limit", async () => {
    const tenant = await Tenant.create({
      name: "Test Tenant",
      plan: "app_base",
      limits: { maxUsers: 5 },
      usage: { currentUsers: 2 },
    });

    const req = { user: { tenant: tenant._id } };
    const res = mockRes();
    const next = vi.fn();

    await checkLimit("maxUsers")(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
  });

  it("blocks access when usage meets or exceeds limit", async () => {
    const { insertedId } = await Tenant.collection.insertOne({
      name: "Test Tenant",
      plan: "app_base",
      limits: { maxUsers: 3 },
      usage: { maxUsers: 3 },
    });

    const req = { user: { tenant: insertedId } };
    const res = mockRes();
    const next = vi.fn();

    await checkLimit("maxUsers")(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          code: "PLAN_LIMIT_EXCEEDED",
        }),
      }),
    );
  });

  it("allows access when limit is 0 or negative (unlimited)", async () => {
    const tenant = await Tenant.create({
      name: "Test Tenant",
      plan: "app_base",
      limits: { maxUsers: -1 },
      usage: { currentUsers: 999 },
    });

    const req = { user: { tenant: tenant._id } };
    const res = mockRes();
    const next = vi.fn();

    await checkLimit("maxUsers")(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it("allows access when limit is undefined", async () => {
    const tenant = await Tenant.create({
      name: "Test Tenant",
      plan: "app_base",
      limits: {},
      usage: { currentUsers: 5 },
    });

    const req = { user: { tenant: tenant._id } };
    const res = mockRes();
    const next = vi.fn();

    await checkLimit("maxUsers")(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it("returns 403 when tenant is not found", async () => {
    const req = { user: { tenant: new mongoose.Types.ObjectId() } };
    const res = mockRes();
    const next = vi.fn();

    await checkLimit("maxUsers")(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });
});
