const {
  baseQuantityFor,
  sumDemandByProduct,
  findUncoveredItem,
} = require("../../src/utils/stockDemand");

const oid = (n) => `000000000000000000000${n}`;

const product = (id, stock, presentations = []) => ({
  _id: oid(id),
  name: `P${id}`,
  stock,
  presentations,
});

describe("baseQuantityFor", () => {
  it("uses the plain quantity when there is no presentation", () => {
    expect(baseQuantityFor({ quantity: 3 }, product(1, 10))).toBe(3);
  });

  it("converts a presentation with its equivalentQty", () => {
    const box = { _id: oid(9), equivalentQty: 12 };
    const p = product(1, 100, [box]);
    expect(baseQuantityFor({ quantity: 2, presentationId: oid(9) }, p)).toBe(24);
  });

  it("falls back to the plain quantity when the presentation is gone", () => {
    expect(baseQuantityFor({ quantity: 2, presentationId: oid(8) }, product(1, 100))).toBe(2);
  });
});

describe("findUncoveredItem", () => {
  it("accepts an order that fits after the pending ones", () => {
    const products = new Map([[oid(1), product(1, 10)]]);
    const pending = [{ items: [{ productId: oid(1), quantity: 6 }] }];
    const requested = { items: [{ productId: oid(1), quantity: 4 }] };

    expect(findUncoveredItem({ requestedOrder: requested, pendingOrders: pending, productsById: products })).toBeNull();
  });

  it("rejects an order that exceeds what is left after pending orders", () => {
    const products = new Map([[oid(1), product(1, 10)]]);
    const pending = [{ items: [{ productId: oid(1), quantity: 6 }] }];
    const requested = { items: [{ productId: oid(1), quantity: 5 }] };

    const result = findUncoveredItem({ requestedOrder: requested, pendingOrders: pending, productsById: products });
    expect(result).toEqual({ product: expect.objectContaining({ name: "P1" }), requested: 5, available: 4 });
  });

  it("counts presentations in base units across orders", () => {
    const box = { _id: oid(9), equivalentQty: 12 };
    const products = new Map([[oid(1), product(1, 24, [box])]]);
    const pending = [{ items: [{ productId: oid(1), quantity: 1, presentationId: oid(9) }] }];
    const requested = { items: [{ productId: oid(1), quantity: 2, presentationId: oid(9) }] };

    const result = findUncoveredItem({ requestedOrder: requested, pendingOrders: pending, productsById: products });
    expect(result.requested).toBe(24);
    expect(result.available).toBe(12);
  });

  it("ignores items without a product id (legacy rows)", () => {
    const products = new Map([[oid(1), product(1, 1)]]);
    const requested = { items: [{ product: "Legacy", quantity: 50 }] };

    expect(findUncoveredItem({ requestedOrder: requested, pendingOrders: [], productsById: products })).toBeNull();
  });
});

describe("sumDemandByProduct", () => {
  it("sums quantities per product across orders", () => {
    const products = new Map([[oid(1), product(1, 100)]]);
    const demand = sumDemandByProduct(
      [{ items: [{ productId: oid(1), quantity: 2 }] }, { items: [{ productId: oid(1), quantity: 3 }] }],
      products,
    );
    expect(demand.get(oid(1))).toBe(5);
  });
});
