import { describe, expect, it } from "vitest";
import { finishSlug, slugifyTyping } from "./format";

describe("enlaces mientras se escribe", () => {
  it("deja escribir el guion final", () => {
    expect(slugifyTyping("mi-")).toBe("mi-");
    expect(slugifyTyping("mi-tienda")).toBe("mi-tienda");
    expect(slugifyTyping("Mi Tienda ")).toBe("mi-tienda-");
  });

  it("limpia tildes, mayúsculas y caracteres raros, y junta guiones repetidos", () => {
    expect(slugifyTyping("Faja Térmica!!")).toBe("faja-termica-");
    expect(slugifyTyping("a -- b")).toBe("a-b");
    expect(slugifyTyping("-hola")).toBe("hola");
  });

  it("al terminar quita el guion final y respeta el largo máximo", () => {
    expect(finishSlug("mi-tienda-")).toBe("mi-tienda");
    expect(finishSlug("  Oferta Única  ")).toBe("oferta-unica");
    expect(finishSlug("a".repeat(39) + "-bbbb", 40)).toBe("a".repeat(39));
    expect(finishSlug("x".repeat(100)).length).toBe(80);
  });
});
