import { describe, expect, it } from "vitest";
import { allowRequest } from "./rate-limit";

describe("Límite por IP", () => {
  it("deja pasar hasta el límite y luego corta", () => {
    const t = 1_000_000;
    expect([1, 2, 3].map(() => allowRequest("prueba:1", 2, 60_000, t))).toEqual([true, true, false]);
  });

  it("se libera cuando pasa la ventana", () => {
    const t = 2_000_000;
    allowRequest("prueba:2", 1, 60_000, t);
    expect(allowRequest("prueba:2", 1, 60_000, t + 1000)).toBe(false);
    expect(allowRequest("prueba:2", 1, 60_000, t + 61_000)).toBe(true);
  });
});
