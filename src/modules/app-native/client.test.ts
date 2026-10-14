import { describe, expect, it } from "vitest";
import { externalUrl } from "./client";

describe("enlaces dentro de la app de celular", () => {
  const here = "https://vendia-theta.vercel.app/dashboard/pedidos/1";

  it("WhatsApp, llamadas, mapas y otras páginas se abren en su app", () => {
    expect(externalUrl("https://wa.me/51900000000?text=hola", here)).toBe("https://wa.me/51900000000?text=hola");
    expect(externalUrl("tel:+51900000000", here)).toBe("tel:+51900000000");
    expect(externalUrl("https://www.google.com/maps?q=-12,-77", here)).toContain("google.com/maps");
    expect(externalUrl("mailto:a@b.pe", here)).toBe("mailto:a@b.pe");
  });

  it("las páginas de Vendia se quedan en la app", () => {
    expect(externalUrl("/rotulos?ids=1,2", here)).toBeNull();
    expect(externalUrl("https://vendia-theta.vercel.app/p/tienda/x", here)).toBeNull();
    expect(externalUrl("#arriba", here)).toBeNull();
    expect(externalUrl("javascript:void(0)", here)).toBeNull();
  });
});
