import { describe, expect, it } from "vitest";
import { abCookieName, pickVariant, variantUrl } from "./ab";

describe("Pruebas A/B", () => {
  const variants = [
    { slug: "faja-dolor", weight: 70 },
    { slug: "faja-postparto", weight: 30 },
  ];

  it("reparte según el peso", () => {
    expect(pickVariant(variants, 0)).toBe("faja-dolor");
    expect(pickVariant(variants, 0.69)).toBe("faja-dolor");
    expect(pickVariant(variants, 0.7)).toBe("faja-postparto");
    expect(pickVariant(variants, 0.999)).toBe("faja-postparto");
  });

  it("pesos en cero: partes iguales; sin variantes: nada", () => {
    const zero = variants.map((v) => ({ ...v, weight: 0 }));
    expect(pickVariant(zero, 0.2)).toBe("faja-dolor");
    expect(pickVariant(zero, 0.8)).toBe("faja-postparto");
    expect(pickVariant([], 0.5)).toBeNull();
  });

  it("la redirección conserva los UTM del anuncio", () => {
    const url = variantUrl("tienda", "faja-postparto", { utm_source: "facebook", ad_id: "123" }, "abc-def");
    expect(url).toBe("/p/tienda/faja-postparto?utm_source=facebook&ad_id=123&vab=abc-def");
    expect(abCookieName("1234-5678")).toBe("vab_12345678");
  });
});
