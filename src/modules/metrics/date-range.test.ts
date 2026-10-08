import { describe, expect, it } from "vitest";
import { formatRangeLabel, limaToday, mondayOf, resolveRange } from "./date-range";

// 2026-10-08 03:00 UTC = 2026-10-07 22:00 en Lima
const now = new Date("2026-10-08T03:00:00.000Z");

describe("Rangos de fecha (hora de Lima)", () => {
  it("'hoy' usa el día de Lima, no el de UTC", () => {
    expect(limaToday(now)).toBe("2026-10-07");
    const r = resolveRange("hoy", undefined, undefined, now);
    expect(r.from).toBe("2026-10-07T05:00:00.000Z");
    expect(r.to).toBe("2026-10-08T05:00:00.000Z");
  });

  it("ayer", () => {
    const r = resolveRange("ayer", undefined, undefined, now);
    expect(r.startDate).toBe("2026-10-06");
    expect(r.endDate).toBe("2026-10-06");
  });

  it("últimos 7 días incluye hoy", () => {
    const r = resolveRange("7d", undefined, undefined, now);
    expect(r.startDate).toBe("2026-10-01");
    expect(r.endDate).toBe("2026-10-07");
  });

  it("mes anterior", () => {
    const r = resolveRange("mes-anterior", undefined, undefined, now);
    expect(r.startDate).toBe("2026-09-01");
    expect(r.endDate).toBe("2026-09-30");
  });

  it("personalizado válido e inválido", () => {
    expect(resolveRange("personalizado", "2026-01-01", "2026-01-31", now).to).toBe("2026-02-01T05:00:00.000Z");
    expect(resolveRange("personalizado", "2026-02-10", "2026-01-01", now).preset).toBe("30d");
    expect(resolveRange("cualquier-cosa", undefined, undefined, now).preset).toBe("30d");
  });
});

describe("Presets estilo Meta", () => {
  // 2026-10-07 en Lima es miércoles
  it("14 y 28 días incluyen hoy", () => {
    expect(resolveRange("14d", undefined, undefined, now).startDate).toBe("2026-09-24");
    expect(resolveRange("28d", undefined, undefined, now).startDate).toBe("2026-09-10");
  });
  it("la semana empieza el lunes", () => {
    expect(mondayOf("2026-10-07")).toBe("2026-10-05");
    expect(mondayOf("2026-10-05")).toBe("2026-10-05");
    expect(mondayOf("2026-10-11")).toBe("2026-10-05");
    const w = resolveRange("semana", undefined, undefined, now);
    expect([w.startDate, w.endDate]).toEqual(["2026-10-05", "2026-10-07"]);
    const lw = resolveRange("semana-pasada", undefined, undefined, now);
    expect([lw.startDate, lw.endDate]).toEqual(["2026-09-28", "2026-10-04"]);
  });
  it("máximo y etiqueta personalizada", () => {
    expect(resolveRange("maximo", undefined, undefined, now).startDate).toBe("2024-01-01");
    expect(formatRangeLabel("2026-09-09", "2026-10-08")).toBe("9 sep 2026 – 8 oct 2026");
  });
});
