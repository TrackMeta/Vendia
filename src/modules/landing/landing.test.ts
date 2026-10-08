import { describe, expect, it } from "vitest";
import { createClassicTemplate, createFormBlock, createPageBlock } from "./defaults";
import { landingContent, PAGE_BLOCK_LABELS } from "./schema";

describe("Contenido de landing", () => {
  it("la plantilla clásica es válida", () => {
    const result = landingContent.safeParse(createClassicTemplate(["a.webp", "b.webp"]));
    expect(result.success).toBe(true);
  });

  it("la plantilla clásica tiene imágenes intercaladas con botones, botón fijo y formulario emergente", () => {
    const content = createClassicTemplate();
    const types = content.page_blocks.map((b) => b.type);
    expect(types.filter((t) => t === "button").length).toBeGreaterThanOrEqual(3);
    expect(types.filter((t) => t === "image").length).toBeGreaterThanOrEqual(5);
    expect(content.sticky_button.enabled).toBe(true);
    expect(content.theme.formMode).toBe("popup");
  });

  it("todos los tipos de bloque por defecto son válidos", () => {
    const content = createClassicTemplate();
    content.page_blocks = (Object.keys(PAGE_BLOCK_LABELS) as (keyof typeof PAGE_BLOCK_LABELS)[]).map(createPageBlock);
    content.form_blocks = [...content.form_blocks, createFormBlock("form_image")];
    expect(landingContent.safeParse(content).success).toBe(true);
  });

  it("rechaza un formulario sin bloque de ofertas o con botón confirmar duplicado", () => {
    const missing = createClassicTemplate();
    missing.form_blocks = missing.form_blocks.filter((b) => b.type !== "form_offers");
    expect(landingContent.safeParse(missing).success).toBe(false);

    const duplicated = createClassicTemplate();
    duplicated.form_blocks.push(createFormBlock("form_submit"));
    expect(landingContent.safeParse(duplicated).success).toBe(false);
  });

  it("rechaza colores inválidos y bloques desconocidos", () => {
    const badColor = createClassicTemplate();
    badColor.sticky_button.bg = "red";
    expect(landingContent.safeParse(badColor).success).toBe(false);

    const unknown = createClassicTemplate() as unknown as { page_blocks: unknown[] };
    unknown.page_blocks.push({ id: "x", type: "script", src: "evil.js" });
    expect(landingContent.safeParse(unknown).success).toBe(false);
  });
});
