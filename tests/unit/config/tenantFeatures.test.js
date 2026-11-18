const { tenantFeatures, APP_BASE, COMPLEMENTS } = require("../../../src/config/complementConfig");

describe("tenantFeatures", () => {
  it("gives the base features to a tenant with no complements", () => {
    const features = tenantFeatures({ complements: [] });
    for (const f of APP_BASE.features) expect(features).toContain(f);
  });

  it("ignores a stale stored list and follows the complements", () => {
    const tenant = { complements: [], enabledFeatures: ["financial_center", "team_management"] };
    expect(tenantFeatures(tenant)).not.toContain("team_management");
    expect(tenantFeatures(tenant)).not.toContain("financial_center");
  });

  it("adds the features of an active complement", () => {
    const features = tenantFeatures({ complements: ["team_10"] });
    expect(features).toContain("team_management");
  });

  it("does not grant the financial panel in the base plan", () => {
    expect(APP_BASE.features).not.toContain("financial_center");
    expect(tenantFeatures({ complements: [] })).not.toContain("financial_center");
    expect(tenantFeatures({ complements: ["financiero"] })).toContain("financial_center");
  });

  it("handles a missing complements field", () => {
    expect(tenantFeatures({})).toEqual(expect.arrayContaining(APP_BASE.features));
    expect(COMPLEMENTS.team_10).toBeDefined();
  });
});

const { tenantLimits } = require("../../../src/config/complementConfig");

describe("tenantLimits", () => {
  it("uses the base limits without complements", () => {
    expect(tenantLimits({ complements: [] })).toEqual(expect.objectContaining({ maxUsers: 1, maxProducts: 200, maxOrdersPerMonth: 500 }));
  });

  it("raises the limits of an active complement", () => {
    expect(tenantLimits({ complements: ["team_10"] }).maxUsers).toBe(10);
  });

  it("applies a superadmin override on top of the complements", () => {
    const limits = tenantLimits({ complements: ["team_10"], limitOverrides: { maxUsers: 3, maxProducts: null } });
    expect(limits.maxUsers).toBe(3);
    expect(limits.maxProducts).toBe(200);
  });

  it("ignores a stored limits field, which can drift", () => {
    const limits = tenantLimits({ complements: [], limits: { maxUsers: 99, maxProducts: 99, maxOrdersPerMonth: 99 } });
    expect(limits.maxUsers).toBe(1);
  });
});

describe("whatsapp complement", () => {
  it("is not part of the base plan", () => {
    expect(tenantFeatures({ complements: [] })).not.toContain("whatsapp");
  });

  it("is granted only by the whatsapp complement", () => {
    expect(tenantFeatures({ complements: ["whatsapp"] })).toContain("whatsapp");
  });
});
