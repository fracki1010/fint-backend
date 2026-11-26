const { resolveLocationScope } = require("../../../src/services/locationScope");
const { getLocationStock } = require("../../../src/controllers/locationController");

const GYM_A = "64b0000000000000000000aa";
const GYM_B = "64b0000000000000000000bb";

describe("resolveLocationScope", () => {
  it("lets the owner see every location or filter by one", () => {
    expect(resolveLocationScope({ role: "admin", location: null }, null)).toBeNull();
    expect(resolveLocationScope({ role: "admin", location: null }, GYM_B)).toBe(GYM_B);
  });

  it("pins a gym user to their own location", () => {
    const gymUser = { role: "ventas", location: GYM_A };
    expect(resolveLocationScope(gymUser, null)).toBe(GYM_A);
    expect(resolveLocationScope(gymUser, GYM_A)).toBe(GYM_A);
  });

  it("refuses a gym user who asks for another location", () => {
    const gymUser = { role: "ventas", location: GYM_A };
    let thrown = null;
    try {
      resolveLocationScope(gymUser, GYM_B);
    } catch (error) {
      thrown = error;
    }
    expect(thrown?.code).toBe("FORBIDDEN_LOCATION");
  });
});

describe("getLocationStock access", () => {
  const fakeRes = () => {
    const res = { statusCode: 200, body: null };
    res.status = (code) => {
      res.statusCode = code;
      return res;
    };
    res.json = (body) => {
      res.body = body;
      return res;
    };
    return res;
  };

  it("answers 403 before touching the database when a gym user asks for another gym", async () => {
    const res = fakeRes();
    await getLocationStock(
      { user: { tenant: GYM_A, role: "ventas", location: GYM_A }, params: { id: GYM_B } },
      res,
    );

    expect(res.statusCode).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN_LOCATION");
  });
});
