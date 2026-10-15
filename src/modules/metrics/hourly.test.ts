import { describe, expect, it } from "vitest";
import { fillHours } from "./hourly";

describe("pedidos por hora", () => {
  it("completa las 24 horas aunque no haya pedidos en todas", () => {
    const h = fillHours([
      { hour: 9, orders: 3 },
      { hour: 21, orders: 7 },
    ]);
    expect(h).toHaveLength(24);
    expect(h[9]).toBe(3);
    expect(h[21]).toBe(7);
    expect(h.reduce((s, n) => s + n, 0)).toBe(10);
  });

  it("ignora horas fuera de rango", () => {
    expect(fillHours([{ hour: 24, orders: 5 }, { hour: -1, orders: 2 }]).every((n) => n === 0)).toBe(true);
  });
});
