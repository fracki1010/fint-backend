const {
  createProductBody,
  updateProductBody,
  createOrderBody,
  createPurchaseBody,
  recipeIngredientSchema,
  createRecipeBody,
  updateRecipeBody,
} = require("../../../src/validators/schemas");

describe("presentation validators", () => {
  const validPresentation = {
    name: "Bolsa 20kg",
    unitOfMeasure: "kg",
    price: 100,
    equivalentQty: 20,
    isActive: true,
  };

  describe("createProductBody with presentations", () => {
    it("accepts a product with valid presentations array", () => {
      const input = {
        name: "Alimento Balanceado Premium",
        price: 50,
        presentations: [validPresentation],
      };

      const result = createProductBody.safeParse(input);

      expect(result.success).toBe(true);
      expect(result.data.presentations).toHaveLength(1);
      expect(result.data.presentations[0].name).toBe("Bolsa 20kg");
      expect(result.data.presentations[0].equivalentQty).toBe(20);
    });

    it("accepts a product without presentations", () => {
      const input = {
        name: "Alimento Balanceado Premium",
        price: 50,
      };

      const result = createProductBody.safeParse(input);

      expect(result.success).toBe(true);
      expect(result.data.presentations).toBeUndefined();
    });

    it("rejects a presentation with missing required fields", () => {
      const input = {
        name: "Alimento Balanceado Premium",
        price: 50,
        presentations: [{ price: 100 }],
      };

      const result = createProductBody.safeParse(input);

      expect(result.success).toBe(false);
    });

    it("rejects a presentation with invalid unitOfMeasure", () => {
      const input = {
        name: "Alimento Balanceado Premium",
        price: 50,
        presentations: [
          { ...validPresentation, unitOfMeasure: "invalid-unit" },
        ],
      };

      const result = createProductBody.safeParse(input);

      expect(result.success).toBe(false);
    });

    it("rejects a presentation with negative equivalentQty", () => {
      const input = {
        name: "Alimento Balanceado Premium",
        price: 50,
        presentations: [
          { ...validPresentation, equivalentQty: -1 },
        ],
      };

      const result = createProductBody.safeParse(input);

      expect(result.success).toBe(false);
    });

    it("rejects a presentation with negative price", () => {
      const input = {
        name: "Alimento Balanceado Premium",
        price: 50,
        presentations: [
          { ...validPresentation, price: -10 },
        ],
      };

      const result = createProductBody.safeParse(input);

      expect(result.success).toBe(false);
    });

    it("accepts a presentation with optional sku and barcode", () => {
      const input = {
        name: "Alimento Balanceado Premium",
        price: 50,
        presentations: [
          {
            ...validPresentation,
            sku: "BOLSA-20",
            barcode: "789123",
          },
        ],
      };

      const result = createProductBody.safeParse(input);

      expect(result.success).toBe(true);
      expect(result.data.presentations[0].sku).toBe("BOLSA-20");
      expect(result.data.presentations[0].barcode).toBe("789123");
    });

    it("accepts a presentation with minimal required fields", () => {
      const input = {
        name: "Alimento Balanceado Premium",
        price: 50,
        presentations: [
          {
            name: "Bolsa 20kg",
            unitOfMeasure: "kg",
            price: 100,
            equivalentQty: 1,
          },
        ],
      };

      const result = createProductBody.safeParse(input);

      expect(result.success).toBe(true);
      expect(result.data.presentations[0].equivalentQty).toBe(1);
      expect(result.data.presentations[0].isActive).toBeUndefined();
    });
  });

  describe("updateProductBody with presentations", () => {
    it("accepts partial update with presentations array", () => {
      const input = {
        presentations: [validPresentation],
      };

      const result = updateProductBody.safeParse(input);

      expect(result.success).toBe(true);
      expect(result.data.presentations).toHaveLength(1);
    });
  });

  describe("product.productPayloadBase with purchase fields", () => {
    it("accepts type raw_material", () => {
      const input = { name: "Test", price: 100, type: "raw_material" };
      const result = createProductBody.safeParse(input);
      expect(result.success).toBe(true);
      expect(result.data.type).toBe("raw_material");
    });

    it("accepts type finished", () => {
      const input = { name: "Test", price: 100, type: "finished" };
      const result = createProductBody.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("accepts type both", () => {
      const input = { name: "Test", price: 100, type: "both" };
      const result = createProductBody.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("rejects invalid type", () => {
      const input = { name: "Test", price: 100, type: "invalid" };
      const result = createProductBody.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("accepts purchaseUnit from UNIT_OPTIONS", () => {
      const input = { name: "Test", price: 100, purchaseUnit: "kg" };
      const result = createProductBody.safeParse(input);
      expect(result.success).toBe(true);
      expect(result.data.purchaseUnit).toBe("kg");
    });

    it("rejects invalid purchaseUnit", () => {
      const input = { name: "Test", price: 100, purchaseUnit: "invalid" };
      const result = createProductBody.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("accepts purchaseEquivalentQty as positive number", () => {
      const input = { name: "Test", price: 100, purchaseEquivalentQty: 2.5 };
      const result = createProductBody.safeParse(input);
      expect(result.success).toBe(true);
      expect(result.data.purchaseEquivalentQty).toBe(2.5);
    });

    it("rejects purchaseEquivalentQty <= 0", () => {
      const input = { name: "Test", price: 100, purchaseEquivalentQty: 0 };
      const result = createProductBody.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe("createPurchaseBody with productItemId", () => {
    it("accepts purchase with productItemId instead of supplyItemId", () => {
      const input = {
        supplierId: "507f1f77bcf86cd799439011",
        date: "2026-05-05",
        paymentCondition: "CASH",
        subtotal: 500,
        tax: 0,
        total: 500,
        items: [{
          productItemId: "507f1f77bcf86cd799439012",
          quantity: 5,
          unitCost: 100,
          lineTotal: 500,
        }],
      };
      const result = createPurchaseBody.safeParse(input);
      expect(result.success).toBe(true);
      expect(result.data.items[0].productItemId).toBe("507f1f77bcf86cd799439012");
    });

    it("accepts purchase with supplyItemId (backwards compat)", () => {
      const input = {
        supplierId: "507f1f77bcf86cd799439011",
        date: "2026-05-05",
        paymentCondition: "CASH",
        subtotal: 500,
        tax: 0,
        total: 500,
        items: [{
          supplyItemId: "507f1f77bcf86cd799439013",
          quantity: 5,
          unitCost: 100,
          lineTotal: 500,
        }],
      };
      const result = createPurchaseBody.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("accepts purchase with both supplyItemId and productItemId", () => {
      const input = {
        supplierId: "507f1f77bcf86cd799439011",
        date: "2026-05-05",
        paymentCondition: "CASH",
        subtotal: 1000,
        tax: 0,
        total: 1000,
        items: [
          { supplyItemId: "507f1f77bcf86cd799439013", quantity: 5, unitCost: 100, lineTotal: 500 },
          { productItemId: "507f1f77bcf86cd799439012", quantity: 3, unitCost: 200, lineTotal: 600 },
        ],
      };
      const result = createPurchaseBody.safeParse(input);
      expect(result.success).toBe(true);
      expect(result.data.items).toHaveLength(2);
    });

    it("rejects purchase item with neither supplyItemId nor productItemId", () => {
      const input = {
        supplierId: "507f1f77bcf86cd799439011",
        date: "2026-05-05",
        paymentCondition: "CASH",
        subtotal: 500,
        tax: 0,
        total: 500,
        items: [{
          quantity: 5,
          unitCost: 100,
          lineTotal: 500,
        }],
      };
      const result = createPurchaseBody.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe("createOrderBody with presentationId in items", () => {
    it("accepts an order item with presentationId", () => {
      const input = {
        client: "507f1f77bcf86cd799439011",
        items: [
          {
            product: "Bolsa 20kg",
            quantity: 2,
            price: 100,
            productId: "507f1f77bcf86cd799439012",
            presentationId: "507f1f77bcf86cd799439013",
          },
        ],
        totalAmount: 200,
      };

      const result = createOrderBody.safeParse(input);

      expect(result.success).toBe(true);
      expect(result.data.items[0].presentationId).toBe(
        "507f1f77bcf86cd799439013",
      );
    });

    it("accepts an order item without presentationId", () => {
      const input = {
        client: "507f1f77bcf86cd799439011",
        items: [
          {
            product: "Bolsa 20kg",
            quantity: 2,
            price: 100,
            productId: "507f1f77bcf86cd799439012",
          },
        ],
        totalAmount: 200,
      };

      const result = createOrderBody.safeParse(input);

      expect(result.success).toBe(true);
      expect(result.data.items[0].presentationId).toBeUndefined();
    });

    it("rejects an invalid presentationId format", () => {
      const input = {
        client: "507f1f77bcf86cd799439011",
        items: [
          {
            product: "Bolsa 20kg",
            quantity: 2,
            price: 100,
            productId: "507f1f77bcf86cd799439012",
            presentationId: "invalid-id",
          },
        ],
        totalAmount: 200,
      };

      const result = createOrderBody.safeParse(input);

      expect(result.success).toBe(false);
    });
  });

  describe("recipeIngredientSchema", () => {
    it("accepts ingredient with productItemId", () => {
      const result = recipeIngredientSchema.safeParse({
        productItemId: "507f1f77bcf86cd799439012",
        quantity: 2,
      });
      expect(result.success).toBe(true);
      expect(result.data.productItemId).toBe("507f1f77bcf86cd799439012");
    });

    it("accepts ingredient with supplyItemId (backward compat)", () => {
      const result = recipeIngredientSchema.safeParse({
        supplyItemId: "507f1f77bcf86cd799439013",
        quantity: 3,
      });
      expect(result.success).toBe(true);
      expect(result.data.supplyItemId).toBe("507f1f77bcf86cd799439013");
    });

    it("accepts ingredient with both supplyItemId and productItemId", () => {
      const result = recipeIngredientSchema.safeParse({
        supplyItemId: "507f1f77bcf86cd799439013",
        productItemId: "507f1f77bcf86cd799439012",
        quantity: 1,
      });
      expect(result.success).toBe(true);
    });

    it("rejects ingredient with neither supplyItemId nor productItemId", () => {
      const result = recipeIngredientSchema.safeParse({
        quantity: 5,
      });
      expect(result.success).toBe(false);
    });

    it("rejects ingredient with negative quantity", () => {
      const result = recipeIngredientSchema.safeParse({
        productItemId: "507f1f77bcf86cd799439012",
        quantity: -1,
      });
      expect(result.success).toBe(false);
    });

    it("rejects ingredient with zero quantity", () => {
      const result = recipeIngredientSchema.safeParse({
        productItemId: "507f1f77bcf86cd799439012",
        quantity: 0,
      });
      expect(result.success).toBe(false);
    });
  });

  describe("createRecipeBody", () => {
    it("accepts valid recipe with product-based ingredients", () => {
      const result = createRecipeBody.safeParse({
        name: "Masa Básica",
        productId: "507f1f77bcf86cd799439011",
        yieldQuantity: 1,
        ingredients: [
          { productItemId: "507f1f77bcf86cd799439012", quantity: 2 },
          { supplyItemId: "507f1f77bcf86cd799439013", quantity: 1 },
        ],
        notes: "Receta de prueba",
      });
      expect(result.success).toBe(true);
      expect(result.data.ingredients).toHaveLength(2);
    });

    it("rejects recipe without name", () => {
      const result = createRecipeBody.safeParse({
        ingredients: [{ productItemId: "507f1f77bcf86cd799439012", quantity: 2 }],
      });
      expect(result.success).toBe(false);
    });

    it("accepts recipe with minimal fields (name only)", () => {
      const result = createRecipeBody.safeParse({
        name: "Minimal Recipe",
      });
      expect(result.success).toBe(true);
    });
  });

  describe("updateRecipeBody", () => {
    it("accepts partial update with only name", () => {
      const result = updateRecipeBody.safeParse({ name: "Updated Name" });
      expect(result.success).toBe(true);
    });

    it("accepts partial update with only ingredients", () => {
      const result = updateRecipeBody.safeParse({
        ingredients: [{ productItemId: "507f1f77bcf86cd799439012", quantity: 5 }],
      });
      expect(result.success).toBe(true);
    });

    it("rejects invalid ingredient in update", () => {
      const result = updateRecipeBody.safeParse({
        ingredients: [{ quantity: 0 }],
      });
      expect(result.success).toBe(false);
    });
  });
});
