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
