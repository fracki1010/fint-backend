const { recalculateAVCO } = require("../../../src/services/costingService");

describe("costingService", () => {
  describe("recalculateAVCO", () => {
    it("returns new costPrice and stock when current stock is 0", () => {
      const result = recalculateAVCO({ stock: 0, costPrice: 0 }, 10, 50);

      expect(result.costPrice).toBe(50);
      expect(result.stock).toBe(10);
    });

    it("returns new costPrice and stock when current costPrice is null", () => {
      const result = recalculateAVCO({ stock: 5, costPrice: null }, 10, 50);

      expect(result.costPrice).toBe(50);
      expect(result.stock).toBe(15);
    });

    it("does nothing when newQty is 0", () => {
      const result = recalculateAVCO({ stock: 10, costPrice: 100 }, 0, 50);

      expect(result.costPrice).toBe(100);
      expect(result.stock).toBe(10);
    });

    it("correctly computes AVCO when adding to existing stock", () => {
      // currentValue = 10 * 100 = 1000
      // newValue = 5 * 200 = 1000
      // totalStock = 15
      // costPrice = 2000 / 15 = 133.33
      const result = recalculateAVCO({ stock: 10, costPrice: 100 }, 5, 200);

      expect(result.costPrice).toBe(133.33);
      expect(result.stock).toBe(15);
    });

    it("rounds costPrice to 2 decimal places", () => {
      // currentValue = 3 * 10 = 30
      // newValue = 7 * 25 = 175
      // totalStock = 10
      // costPrice = 205 / 10 = 20.5
      const result = recalculateAVCO({ stock: 3, costPrice: 10 }, 7, 25);

      expect(result.costPrice).toBe(20.5);
      expect(result.stock).toBe(10);
    });

    it("handles large quantities without precision loss", () => {
      const result = recalculateAVCO({ stock: 1000, costPrice: 999.99 }, 500, 500.5);

      const expectedCostPrice = Math.round((1000 * 999.99 + 500 * 500.5) / 1500 * 100) / 100;
      expect(result.costPrice).toBe(expectedCostPrice);
      expect(result.stock).toBe(1500);
    });

    it("treats costPrice as 0 when stock is 0", () => {
      const result = recalculateAVCO({ stock: 0, costPrice: 100 }, 10, 75);

      expect(result.costPrice).toBe(75);
      expect(result.stock).toBe(10);
    });

    it("uses newUnitCost when stock > 0 but costPrice is 0", () => {
      const result = recalculateAVCO({ stock: 10, costPrice: 0 }, 5, 80);

      expect(result.costPrice).toBe(80);
      expect(result.stock).toBe(15);
    });
  });
});
