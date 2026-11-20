const {
  parsePaymentStatus,
  parsePaymentMethod,
  parseDelivery,
  parseYesNo,
  parsePaidAmount,
  buildOrderStatusFields,
  describeWizardAnswers,
} = require("../../../src/services/orderWizardService");

describe("parsePaymentStatus", () => {
  it.each([
    ["1", "paid"],
    ["pagado", "paid"],
    ["sí", "paid"],
    ["ya pagó", "paid"],
    ["2", "partial"],
    ["pago parcial", "partial"],
    ["a cuenta", "partial"],
    ["3", "pending"],
    ["pendiente de pago", "pending"],
    ["no pagó", "pending"],
  ])("reads %s as %s", (text, expected) => {
    expect(parsePaymentStatus(text)).toBe(expected);
  });

  it("returns null for an unclear answer so the question repeats", () => {
    expect(parsePaymentStatus("después te digo")).toBeNull();
  });
});

describe("parsePaymentMethod", () => {
  it.each([
    ["efectivo", "cash"],
    ["transferencia", "transfer"],
    ["3", "card"],
    ["tarjeta", "card"],
    ["mercado pago", "mercadopago"],
    ["mp", "mercadopago"],
    ["otro", "other"],
  ])("reads %s as %s", (text, expected) => {
    expect(parsePaymentMethod(text)).toBe(expected);
  });

  it("returns null when no method matches", () => {
    expect(parsePaymentMethod("cheque de un amigo")).toBeNull();
  });
});

describe("parseDelivery", () => {
  it.each([
    ["1", true],
    ["entregado", true],
    ["ya lo llevó", true],
    ["2", false],
    ["pendiente", false],
    ["mañana", false],
  ])("reads %s as %s", (text, expected) => {
    expect(parseDelivery(text)).toBe(expected);
  });

  it("returns null for a bare no, which does not say whether it is delivered", () => {
    expect(parseDelivery("no")).toBeNull();
  });
});

describe("parseYesNo", () => {
  it("reads yes and no variants", () => {
    expect(parseYesNo("sí")).toBe(true);
    expect(parseYesNo("dale")).toBe(true);
    expect(parseYesNo("no")).toBe(false);
    expect(parseYesNo("tal vez")).toBeNull();
  });
});

describe("parsePaidAmount", () => {
  it("reads locale amounts below the total", () => {
    expect(parsePaidAmount("$1.500", 3000)).toBe(1500);
    expect(parsePaidAmount("750,5", 3000)).toBe(750.5);
  });

  it.each([["0", 3000], ["3000", 3000], ["5000", 3000], ["mucho", 3000]])(
    "rejects %s against total %s",
    (text, total) => {
      expect(parsePaidAmount(text, total)).toBeNull();
    },
  );
});

describe("buildOrderStatusFields", () => {
  const now = new Date("2026-11-20T12:00:00Z");

  it("marks a fully paid and delivered sale as settled", () => {
    const fields = buildOrderStatusFields({
      payment: { status: "paid", method: "cash", paidAmount: 3000 },
      total: 3000,
      delivered: true,
      now,
    });

    expect(fields).toMatchObject({
      paymentStatus: "Pagado",
      paymentMethod: "cash",
      paymentSplits: [{ method: "cash", amount: 3000 }],
      status: "Entregado",
      deliveryStatus: "Entregada",
    });
    expect(fields.paidAt).toEqual(now);
    expect(fields.deliveredAt).toEqual(now);
  });

  it("keeps a pending-payment sale open with no payment recorded", () => {
    const fields = buildOrderStatusFields({
      payment: { status: "pending", method: null, paidAmount: 0 },
      total: 3000,
      delivered: false,
      now,
    });

    expect(fields).toMatchObject({
      paymentStatus: "Pendiente",
      paymentMethod: "",
      paymentSplits: [],
      paidAt: null,
      status: "Confirmada",
      deliveryStatus: "Pendiente",
      deliveredAt: null,
    });
  });

  it("records only the paid part for a partial payment", () => {
    const fields = buildOrderStatusFields({
      payment: { status: "partial", method: "transfer", paidAmount: 1000 },
      total: 3000,
      delivered: true,
      now,
    });

    expect(fields.paymentStatus).toBe("Parcial");
    expect(fields.paymentSplits).toEqual([{ method: "transfer", amount: 1000 }]);
  });
});

describe("describeWizardAnswers", () => {
  it("explains payment, delivery and invoice in plain words", () => {
    const lines = describeWizardAnswers({
      payment: { status: "partial", method: "cash", paidAmount: 1000 },
      delivered: false,
      invoice: true,
      total: 3000,
    });

    expect(lines[0]).toContain("parcial");
    expect(lines[0]).toContain("Efectivo");
    expect(lines[1]).toContain("pendiente de entrega");
    expect(lines[2]).toContain("sí");
  });
});
