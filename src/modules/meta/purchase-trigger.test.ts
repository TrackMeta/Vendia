import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { reachedPurchaseTrigger } = await import("./capi");

const base = { confirmed_at: null, shipped_at: null, delivered_at: null, collected_at: null, status: "new" };

describe("Disparador de Purchase (venta real)", () => {
  it("por defecto dispara solo al entregar", () => {
    expect(reachedPurchaseTrigger({ ...base, status: "confirmed", confirmed_at: "x" }, "delivered")).toBe(false);
    expect(reachedPurchaseTrigger({ ...base, status: "delivered", confirmed_at: "x", shipped_at: "x", delivered_at: "x" }, "delivered")).toBe(true);
  });

  it("nunca dispara si el pedido no se entregó o fue devuelto/cancelado", () => {
    expect(reachedPurchaseTrigger({ ...base, status: "failed_delivery", shipped_at: "x" }, "shipped")).toBe(false);
    expect(reachedPurchaseTrigger({ ...base, status: "returned", shipped_at: "x" }, "shipped")).toBe(false);
    expect(reachedPurchaseTrigger({ ...base, status: "cancelled", confirmed_at: "x" }, "confirmed")).toBe(false);
  });

  it("respeta el estado configurado por la tienda", () => {
    const shipped = { ...base, status: "shipped", confirmed_at: "x", shipped_at: "x" };
    expect(reachedPurchaseTrigger(shipped, "confirmed")).toBe(true);
    expect(reachedPurchaseTrigger(shipped, "shipped")).toBe(true);
    expect(reachedPurchaseTrigger(shipped, "delivered")).toBe(false);
    expect(reachedPurchaseTrigger({ ...shipped, status: "collected", delivered_at: "x", collected_at: "x" }, "collected")).toBe(true);
  });
});
