import { describe, expect, it } from "vitest";
import { fillThankYouMessage } from "./thank-you";

describe("Mensaje de WhatsApp de la página de gracias", () => {
  it("reemplaza tienda, pedido y producto", () => {
    expect(fillThankYouMessage("Hola {tienda}, acabo de hacer el pedido {pedido} de {producto}.", { store: "Mi Tienda", orderNumber: "1024", product: "Faja" })).toBe(
      "Hola Mi Tienda, acabo de hacer el pedido #1024 de Faja.",
    );
  });

  it("sin número de pedido no deja espacios raros", () => {
    expect(fillThankYouMessage("Hola, hice el pedido {pedido}.", { store: "X", orderNumber: null, product: "Y" })).toBe("Hola, hice el pedido.");
  });

  it("un texto sin llaves queda igual", () => {
    expect(fillThankYouMessage("Quiero confirmar mi compra", { store: "X", orderNumber: "1", product: "Y" })).toBe("Quiero confirmar mi compra");
  });
});
