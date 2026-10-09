import { describe, expect, it } from "vitest";
import { isSyncDue, parseSyncInterval } from "./schedule";

describe("Lectura programada de Meta", () => {
  const now = Date.parse("2026-10-09T12:00:00Z");
  const ago = (min: number) => new Date(now - min * 60_000).toISOString();

  it("lee si nunca se leyó o si ya pasó su intervalo", () => {
    expect(isSyncDue(null, 60, now)).toBe(true);
    expect(isSyncDue(ago(61), 60, now)).toBe(true);
    expect(isSyncDue(ago(30), 60, now)).toBe(false);
    expect(isSyncDue(ago(200), 360, now)).toBe(false);
  });

  it("no se salta una hora por unos segundos de diferencia del reloj", () => {
    expect(isSyncDue(ago(57), 60, now)).toBe(true);
  });

  it("acepta solo los intervalos de la lista", () => {
    expect(parseSyncInterval(180)).toBe(180);
    expect(parseSyncInterval("1440")).toBe(1440);
    expect(parseSyncInterval(5)).toBe(60);
    expect(parseSyncInterval(undefined)).toBe(60);
  });
});
