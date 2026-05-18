const {
  COMPLEMENTS,
  APP_BASE,
  deriveEnabledFeatures,
  deriveLimits,
  computeTotalPrice,
} = require("../../../src/config/complementConfig");

describe("complementConfig", () => {
  describe("APP_BASE", () => {
    it("has the expected price, features, and limits", () => {
      expect(APP_BASE.price).toBe(200);
      expect(APP_BASE.features).toContain("client_account");
      expect(APP_BASE.features).toContain("supplier_account");
      expect(APP_BASE.features).toContain("quotes");
      expect(APP_BASE.features).toContain("banking");
      expect(APP_BASE.features).toContain("financial_center");
      expect(APP_BASE.limits.maxUsers).toBe(1);
      expect(APP_BASE.limits.maxProducts).toBe(200);
      expect(APP_BASE.limits.maxOrdersPerMonth).toBe(500);
    });
  });

  describe("deriveEnabledFeatures", () => {
    it("returns app base features when no complements are active", () => {
      const features = deriveEnabledFeatures([]);
      expect(features).toEqual(APP_BASE.features);
    });

    it("merges features from active complements", () => {
      const features = deriveEnabledFeatures(["expansion", "team_10"]);
      expect(features).toContain("client_account");
      expect(features).toContain("team_management");
      expect(features).toContain("unlimited_products");
      expect(features).toContain("unlimited_orders");
    });

    it("deduplicates features across complements", () => {
      const features = deriveEnabledFeatures(["contabilidad", "reportes"]);
      // Both provide advanced_reports
      expect(features.filter((f) => f === "advanced_reports")).toHaveLength(1);
    });

    it("ignores unknown complement IDs", () => {
      const features = deriveEnabledFeatures(["unknown_id"]);
      expect(features).toEqual(APP_BASE.features);
    });
  });

  describe("deriveLimits", () => {
    it("returns app base limits when no complements are active", () => {
      const limits = deriveLimits([]);
      expect(limits).toEqual(APP_BASE.limits);
    });

    it("overrides limits from active complements", () => {
      const limits = deriveLimits(["expansion"]);
      expect(limits.maxProducts).toBe(-1);
      expect(limits.maxOrdersPerMonth).toBe(-1);
      // App base limits that are not overridden remain
      expect(limits.maxUsers).toBe(1);
    });

    it("later complements override earlier ones", () => {
      const limits = deriveLimits(["team_10", "team_unlimited"]);
      expect(limits.maxUsers).toBe(-1);
    });

    it("ignores unknown complement IDs", () => {
      const limits = deriveLimits(["unknown_id"]);
      expect(limits).toEqual(APP_BASE.limits);
    });
  });

  describe("computeTotalPrice", () => {
    it("returns app base price when no complements are active", () => {
      expect(computeTotalPrice([])).toBe(200);
    });

    it("sums app base + complement prices", () => {
      expect(computeTotalPrice(["expansion", "team_10"])).toBe(400);
    });

    it("ignores unknown complement IDs", () => {
      expect(computeTotalPrice(["unknown_id"])).toBe(200);
    });
  });

  describe("COMPLEMENTS registry", () => {
    it("contains expected complement definitions", () => {
      expect(COMPLEMENTS.expansion).toBeDefined();
      expect(COMPLEMENTS.team_10).toBeDefined();
      expect(COMPLEMENTS.team_unlimited).toBeDefined();
      expect(COMPLEMENTS.financiero).toBeDefined();
      expect(COMPLEMENTS.api).toBeDefined();
    });

    it("each complement has id, name, price, and features", () => {
      for (const [key, comp] of Object.entries(COMPLEMENTS)) {
        expect(comp.id).toBe(key);
        expect(typeof comp.name).toBe("string");
        expect(typeof comp.price).toBe("number");
        expect(Array.isArray(comp.features)).toBe(true);
      }
    });

    it("conciliacion provides bank_reconciliation (not banking which is in app base)", () => {
      expect(COMPLEMENTS.conciliacion.features).toContain("bank_reconciliation");
      expect(COMPLEMENTS.conciliacion.features).not.toContain("banking");
    });
  });
});
