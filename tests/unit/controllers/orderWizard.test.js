const { advanceOrderWizard } = require("../../../src/controllers/iaController");

const newWizard = (canInvoice) => ({
  intent: "NUEVO_PEDIDO_WIZARD",
  step: "PAYMENT_STATUS",
  canInvoice,
  orderDraft: { totalAmount: 3000 },
});

describe("advanceOrderWizard", () => {
  it("asks payment method after a full payment, then delivery, then finishes without invoice", () => {
    const wizard = newWizard(false);

    expect(advanceOrderWizard(wizard, "pagado", 3000).reply).toMatch(/medio/i);
    expect(wizard.payment).toMatchObject({ status: "paid", paidAmount: 3000 });

    expect(advanceOrderWizard(wizard, "efectivo", 3000).reply).toMatch(/entregaste/i);
    expect(wizard.payment.method).toBe("cash");

    expect(advanceOrderWizard(wizard, "entregado", 3000)).toEqual({ done: true });
    expect(wizard.delivered).toBe(true);
    expect(wizard.invoice).toBe(false);
  });

  it("asks the amount for a partial payment before the method", () => {
    const wizard = newWizard(false);

    expect(advanceOrderWizard(wizard, "2", 3000).reply).toMatch(/cuánto/i);
    expect(advanceOrderWizard(wizard, "5000", 3000).reply).toMatch(/monto no sirve/);
    expect(advanceOrderWizard(wizard, "1000", 3000).reply).toMatch(/medio/i);
    expect(wizard.payment.paidAmount).toBe(1000);
  });

  it("skips payment method for a pending sale and asks delivery next", () => {
    const wizard = newWizard(false);

    expect(advanceOrderWizard(wizard, "pendiente", 3000).reply).toMatch(/entregaste/i);
    expect(wizard.payment.method).toBeNull();
  });

  it("asks the invoice question only when the channel can send PDFs", () => {
    const wizard = newWizard(true);
    advanceOrderWizard(wizard, "3", 3000);
    expect(advanceOrderWizard(wizard, "1", 3000).reply).toMatch(/factura/i);
    expect(advanceOrderWizard(wizard, "sí", 3000)).toEqual({ done: true });
    expect(wizard.invoice).toBe(true);
  });

  it("repeats the same question when the answer is unclear", () => {
    const wizard = newWizard(false);
    const result = advanceOrderWizard(wizard, "quizás mañana", 3000);

    expect(result.reply).toMatch(/No te entendí/);
    expect(wizard.step).toBe("PAYMENT_STATUS");
  });
});
