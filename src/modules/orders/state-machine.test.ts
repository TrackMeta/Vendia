import { describe, expect, it } from "vitest";
import { allowedTransitions, isTransitionAllowed, nextStatus } from "./state-machine";

describe("Máquina de estados del pedido", () => {
  it("avanza por la cadena principal, incluso saltando pasos", () => {
    expect(isTransitionAllowed("new", "pending_confirmation")).toBe(true);
    expect(isTransitionAllowed("new", "confirmed")).toBe(true);
    expect(isTransitionAllowed("confirmed", "shipped")).toBe(true);
    expect(isTransitionAllowed("shipped", "delivered")).toBe(true);
    expect(isTransitionAllowed("delivered", "collected")).toBe(true);
  });

  it("no retrocede en la cadena principal", () => {
    expect(isTransitionAllowed("shipped", "confirmed")).toBe(false);
    expect(isTransitionAllowed("delivered", "new")).toBe(false);
    expect(isTransitionAllowed("confirmed", "confirmed")).toBe(false);
  });

  it("cancelar solo antes de que salga el pedido", () => {
    expect(isTransitionAllowed("new", "cancelled")).toBe(true);
    expect(isTransitionAllowed("preparing", "cancelled")).toBe(true);
    expect(isTransitionAllowed("shipped", "cancelled")).toBe(false);
    expect(isTransitionAllowed("delivered", "cancelled")).toBe(false);
  });

  it("no entregado solo después de salir; devuelto solo desde no entregado", () => {
    expect(isTransitionAllowed("confirmed", "failed_delivery")).toBe(false);
    expect(isTransitionAllowed("shipped", "failed_delivery")).toBe(true);
    expect(isTransitionAllowed("out_for_delivery", "failed_delivery")).toBe(true);
    expect(isTransitionAllowed("failed_delivery", "returned")).toBe(true);
    expect(isTransitionAllowed("shipped", "returned")).toBe(false);
  });

  it("un cancelado se puede reabrir, pero no saltar a entregado", () => {
    expect(isTransitionAllowed("cancelled", "pending_confirmation")).toBe(true);
    expect(isTransitionAllowed("cancelled", "delivered")).toBe(false);
  });

  it("estados finales", () => {
    expect(allowedTransitions("collected")).toEqual([]);
    expect(allowedTransitions("returned")).toEqual([]);
    expect(nextStatus("collected")).toBeNull();
    expect(nextStatus("new")).toBe("pending_confirmation");
  });
});

describe("Provincia: el orden es inverso a Lima", () => {
  it("Enviado → En agencia → Cobrado → Entregado", () => {
    expect(nextStatus("shipped", "provincia")).toBe("at_agency");
    expect(nextStatus("at_agency", "provincia")).toBe("collected");
    expect(nextStatus("collected", "provincia")).toBe("delivered");
    expect(nextStatus("delivered", "provincia")).toBeNull();
  });

  it("Lima no pasa por agencia y provincia no pasa por reparto", () => {
    expect(isTransitionAllowed("shipped", "at_agency", "lima")).toBe(false);
    expect(isTransitionAllowed("shipped", "out_for_delivery", "provincia")).toBe(false);
    expect(isTransitionAllowed("collected", "delivered", "lima")).toBe(false);
    expect(isTransitionAllowed("collected", "delivered", "provincia")).toBe(true);
  });

  it("no recogió en agencia → No entregado", () => {
    expect(isTransitionAllowed("at_agency", "failed_delivery", "provincia")).toBe(true);
    expect(allowedTransitions("delivered", "provincia")).toEqual([]);
  });
});
