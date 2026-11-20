const tenantRoutes = require("../../../src/routes/tenantRoutes");
const { requireSuperAdmin } = require("../../../src/middlewares/superAdminMiddleware");

// Express keeps each route's handlers in its own stack; read them without starting a server.
const handlersFor = (path) => {
  const layer = tenantRoutes.stack.find((item) => item.route?.path === path);
  return layer ? layer.route.stack.map((item) => item.handle) : [];
};

describe("POST /activate-complements route guard", () => {
  it("requires a superadmin after authentication", () => {
    const handlers = handlersFor("/activate-complements");

    expect(handlers).toContain(requireSuperAdmin);
    expect(handlers.indexOf(requireSuperAdmin)).toBeGreaterThan(0);
  });

  it("rejects a tenant owner before the controller runs", () => {
    const res = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(body) {
        this.body = body;
        return this;
      },
    };
    const next = vi.fn();

    requireSuperAdmin({ user: { isSuperAdmin: false, role: "admin" } }, res, next);

    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });
});
