const {
  buildRotationFacts,
  findUnsupportedNumbers,
  parseLocaleNumber,
  renderFallbackSummary,
} = require("../../../src/services/inventoryAnalyticsService");

const id = (n) => `64b000000000000000000${String(n).padStart(3, "0")}`;

const products = [
  { _id: id(1), name: "Arroz", stock: 10, costPrice: 100, unitOfMeasure: "kg", category: "Granos" },
  { _id: id(2), name: "Yerba", stock: 40, costPrice: 50, unitOfMeasure: "paquete" },
  { _id: id(3), name: "Vino", stock: 6, costPrice: 200, unitOfMeasure: "botella" },
];

const salesByProduct = new Map([
  // 30 units in 90 days, 20 of them in the last 30 days, 5 in the previous 30.
  [id(1), { sold30: 20, sold60: 25, sold90: 30, revenue90: 6000, cost90: 3000 }],
  // Nothing in the last 60 days.
  [id(3), { sold30: 0, sold60: 0, sold90: 2, revenue90: 800, cost90: 600 }],
]);

describe("buildRotationFacts", () => {
  const facts = buildRotationFacts({ products, salesByProduct });

  it("computes rotation and cover from current stock", () => {
    const arroz = facts.fastestMovers.find((row) => row.name === "Arroz");
    expect(arroz.rotation90).toBe(3); // 30 sold / 10 in stock
    expect(arroz.coverDays).toBe(30); // 10 stock / (30 / 90 per day)
  });

  it("derives the trend from the last 30 days against the 30 before", () => {
    const arroz = facts.fastestMovers.find((row) => row.name === "Arroz");
    expect(arroz.trendPct).toBe(300); // (20 - 5) / 5
    expect(facts.risingSales[0].name).toBe("Arroz");
  });

  it("flags idle stock and values the capital tied in it", () => {
    // Sorted by capital tied: Yerba 40 x 50 = 2000 before Vino 6 x 200 = 1200.
    expect(facts.idleStock.map((row) => row.name)).toEqual(["Yerba", "Vino"]);
    expect(facts.totals.idleCount).toBe(2);
    expect(facts.totals.idleCapitalTied).toBe(1200 + 2000);
  });

  it("computes margin only when revenue and cost exist", () => {
    const arroz = facts.fastestMovers.find((row) => row.name === "Arroz");
    expect(arroz.marginPct).toBe(50);
    const yerba = facts.idleStock.find((row) => row.name === "Yerba");
    expect(yerba.marginPct).toBeNull();
  });

  it("marks data as insufficient below the minimum units", () => {
    const sparse = buildRotationFacts({ products, salesByProduct: new Map() });
    expect(sparse.enoughData).toBe(false);
    expect(sparse.totals.unitsSold90).toBe(0);
  });
});

describe("parseLocaleNumber", () => {
  it.each([
    ["1.234,5", 1234.5],
    ["12,5", 12.5],
    ["1.234", 1234],
    ["$15.000", 15000],
    ["42", 42],
  ])("reads %s as %s", (raw, expected) => {
    expect(parseLocaleNumber(raw)).toBe(expected);
  });
});

describe("findUnsupportedNumbers", () => {
  const facts = buildRotationFacts({ products, salesByProduct });

  it("accepts numbers that come from the facts", () => {
    expect(findUnsupportedNumbers("Arroz rota 3 veces, cobertura 30 días", facts)).toEqual([]);
  });

  it("accepts absolute values of negative facts", () => {
    const falling = { ...facts, fallingSales: [{ trendPct: -40 }] };
    expect(findUnsupportedNumbers("Yerba cae 40%", falling)).toEqual([]);
  });

  it("flags numbers the model made up", () => {
    expect(findUnsupportedNumbers("Conviene comprar 77 unidades de Arroz", facts)).toEqual([77]);
  });

  it("does not treat product ids as business numbers", () => {
    expect(findUnsupportedNumbers("Yerba parada", facts)).toEqual([]);
  });
});

describe("renderFallbackSummary", () => {
  it("asks for more data when sales are thin", () => {
    const facts = buildRotationFacts({ products, salesByProduct: new Map() });
    expect(renderFallbackSummary(facts)).toMatch(/pocas ventas/);
  });

  it("summarises the calculated facts without the model", () => {
    const facts = buildRotationFacts({ products, salesByProduct });
    const text = renderFallbackSummary(facts);
    expect(text).toContain("Arroz");
    expect(text).toContain("2 productos");
  });
});
