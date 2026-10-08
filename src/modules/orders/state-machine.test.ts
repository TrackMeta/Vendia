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
