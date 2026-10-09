import { describe, expect, it } from "vitest";
import { buildSeries } from "./daily";

describe("Serie de ventas por día", () => {
  it("rellena con ceros los días sin pedidos", () => {
    const s = buildSeries([{ day: "2026-10-02", orders: 5, sales: 2, revenue: 180 }], "2026-10-01", "2026-10-03");
    expect(s.map((p) => [p.day, p.orders, p.sales])).toEqual([
      ["2026-10-01", 0, 0],
      ["2026-10-02", 5, 2],
      ["2026-10-03", 0, 0],
    ]);
    expect(s[0].unit).toBe("day");
  });

  it("agrupa por semana (desde el lunes) cuando el rango pasa de 2 meses", () => {
    const s = buildSeries(
      [
        { day: "2026-07-06", orders: 3, sales: 1, revenue: 90 },
        { day: "2026-07-08", orders: 2, sales: 2, revenue: 180 },
      ],
      "2026-07-01",
      "2026-10-08",
    );
    expect(s[0].unit).toBe("week");
    expect(s.find((p) => p.day === "2026-07-06")).toMatchObject({ orders: 5, sales: 3, revenue: 270 });
  });

  it("en «Máximo» empieza en el primer día con pedidos", () => {
    const s = buildSeries([{ day: "2026-09-20", orders: 1, sales: 0, revenue: 0 }], "2020-01-01", "2026-10-08");
    expect(s[0].day).toBe("2026-09-20");
    expect(s[0].unit).toBe("day");
  });
});
