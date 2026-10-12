import { describe, expect, it, vi } from "vitest";
import { savedPriceVariant, signPriceVariantB, verifyPriceVariant } from "./price-test";

vi.mock("server-only", () => ({}));

const LANDING = "3f1c2b8e-7a4d-4e0b-9c1a-2b3c4d5e6f70";
const OTHER = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const KEY = "clave-de-prueba";

describe("Prueba de precio firmada", () => {
  it("acepta la ficha B firmada para la misma landing", () => {
    const token = signPriceVariantB(LANDING, KEY);
    expect(token.startsWith("B.")).toBe(true);
    expect(verifyPriceVariant(LANDING, token, KEY)).toBe("B");
  });

  it("cualquier otra cosa es precio normal (A)", () => {
    const token = signPriceVariantB(LANDING, KEY);
    expect(verifyPriceVariant(LANDING, "B", KEY)).toBe("A");
    expect(verifyPriceVariant(LANDING, "A", KEY)).toBe("A");
    expect(verifyPriceVariant(LANDING, undefined, KEY)).toBe("A");
    expect(verifyPriceVariant(LANDING, "B.falsa", KEY)).toBe("A");
    expect(verifyPriceVariant(OTHER, token, KEY)).toBe("A");
    expect(verifyPriceVariant(LANDING, token, "otra-clave")).toBe("A");
    expect(verifyPriceVariant(LANDING, `${token}x`, KEY)).toBe("A");
  });

  it("una cookie vieja «B» sin firma se vuelve a sortear", () => {
    expect(savedPriceVariant(LANDING, "B", KEY)).toBeNull();
    expect(savedPriceVariant(LANDING, undefined, KEY)).toBeNull();
    expect(savedPriceVariant(LANDING, "A", KEY)).toBe("A");
    expect(savedPriceVariant(LANDING, signPriceVariantB(LANDING, KEY), KEY)).toBe("B");
  });

  it("usa PRICE_TEST_SECRET o, si falta, una clave derivada de SUPABASE_SECRET_KEY", () => {
    const before = { own: process.env.PRICE_TEST_SECRET, base: process.env.SUPABASE_SECRET_KEY };
    try {
      delete process.env.PRICE_TEST_SECRET;
      process.env.SUPABASE_SECRET_KEY = "sb_secret_demo";
      const derived = signPriceVariantB(LANDING);
      expect(derived).not.toContain("sb_secret_demo");
      expect(verifyPriceVariant(LANDING, derived)).toBe("B");
      process.env.PRICE_TEST_SECRET = "propia";
      expect(verifyPriceVariant(LANDING, derived)).toBe("A");
      expect(verifyPriceVariant(LANDING, signPriceVariantB(LANDING))).toBe("B");
    } finally {
      if (before.own === undefined) delete process.env.PRICE_TEST_SECRET;
      else process.env.PRICE_TEST_SECRET = before.own;
      if (before.base === undefined) delete process.env.SUPABASE_SECRET_KEY;
      else process.env.SUPABASE_SECRET_KEY = before.base;
    }
  });
});
