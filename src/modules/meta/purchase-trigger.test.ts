import { describe, expect, it } from "vitest";
import { isRealSale, saleStatusLabel } from "@/modules/metrics/real-sale";

const base = { delivered_at: null, collected_at: null };

describe("Venta real (dispara Purchase en Meta)", () => {
  it("por zona: Lima al entregar, provincia al cobrar el saldo", () => {
    expect(isRealSale({ ...base, status: "delivered", zone: "lima", delivered_at: "x" }, "zone")).toBe(true);
    expect(isRealSale({ ...base, status: "shipped", zone: "lima" }, "zone")).toBe(false);
    expect(isRealSale({ ...base, status: "collected", zone: "provincia", collected_at: "x" }, "zone")).toBe(true);
    expect(isRealSale({ ...base, status: "at_agency", zone: "provincia" }, "zone")).toBe(false);
  });

  it("«Entregado» en ambas: provincia espera a que recoja", () => {
    expect(isRealSale({ ...base, status: "collected", zone: "provincia", collected_at: "x" }, "delivered")).toBe(false);
    expect(isRealSale({ ...base, status: "delivered", zone: "provincia", collected_at: "x", delivered_at: "x" }, "delivered")).toBe(true);
  });

  it("nunca cuenta lo cancelado, no entregado o devuelto", () => {
    expect(isRealSale({ status: "failed_delivery", zone: "lima", delivered_at: "x", collected_at: null }, "zone")).toBe(false);
    expect(isRealSale({ status: "returned", zone: "provincia", delivered_at: null, collected_at: "x" }, "zone")).toBe(false);
  });

  it("etiqueta del estado de venta", () => {
    expect(saleStatusLabel("provincia", "zone")).toBe("Cobrado");
    expect(saleStatusLabel("provincia", "delivered")).toBe("Entregado");
    expect(saleStatusLabel("lima", "zone")).toBe("Entregado");
  });
});
