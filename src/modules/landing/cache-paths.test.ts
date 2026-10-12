import { describe, expect, it } from "vitest";
import { contentUsesPath } from "./cache-paths";

describe("contentUsesPath", () => {
  const path = "store-1/products/p1/foto.jpg";

  it("encuentra la ruta en bloques anidados", () => {
    const content = { page_blocks: [{ type: "carousel", images: [{ src: path }] }] };
    expect(contentUsesPath(content, path)).toBe(true);
  });

  it("no confunde rutas que solo empiezan igual", () => {
    const content = { page_blocks: [{ type: "image", src: `${path}.webp` }] };
    expect(contentUsesPath(content, path)).toBe(false);
  });

  it("ignora contenido vacío o ruta vacía", () => {
    expect(contentUsesPath(null, path)).toBe(false);
    expect(contentUsesPath({ src: "" }, "")).toBe(false);
  });
});
