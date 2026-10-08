import { describe, expect, it } from "vitest";
import { limaToday, resolveRange } from "./date-range";

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
