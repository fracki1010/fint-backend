const { quickConfirmation } = require("../../../src/controllers/iaController");

describe("quickConfirmation", () => {
  it.each(["sí", "si", "Dale.", "ok", "confirmo", "obvio", "👍"])("reads %s as a confirmation", (text) => {
    expect(quickConfirmation(text)).toBe("CONFIRMAR");
  });

  it.each(["no", "Cancelar", "olvidalo"])("reads %s as a cancellation", (text) => {
    expect(quickConfirmation(text)).toBe("CANCELAR");
  });

  it("leaves anything more specific to the model", () => {
    expect(quickConfirmation("sí pero cambiá la cantidad a 5")).toBeNull();
    expect(quickConfirmation("quizás")).toBeNull();
  });
});
