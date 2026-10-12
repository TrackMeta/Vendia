import { describe, expect, it } from "vitest";
import { createClassicTemplate, createFormBlock, normalizeContent } from "./defaults";
import { publicUpsell, stripContentCosts } from "./public-content";
import type { FormBlock, LandingContent } from "./schema";

function withCosts(): LandingContent {
  const content = createClassicTemplate();
  const bumps = createFormBlock("form_bumps") as Extract<FormBlock, { type: "form_bumps" }>;
  bumps.items = bumps.items.map((i) => ({ ...i, cost: 7.5 }));
  content.form_blocks = [...content.form_blocks, bumps];
  content.thank_you_upsell = { ...content.thank_you_upsell, enabled: true, name: "Extra", price: 20, cost: 9 };
  return content;
}

describe("Contenido público sin costos", () => {
  it("quita el costo de los adicionales y de la oferta de gracias", () => {
    const clean = stripContentCosts(withCosts());
    expect(JSON.stringify(clean)).not.toContain('"cost"');
    const bumps = clean.form_blocks.find((b) => b.type === "form_bumps") as Extract<FormBlock, { type: "form_bumps" }>;
    expect(bumps.items[0].price).toBe(19.9);
    expect(clean.thank_you_upsell.price).toBe(20);
  });

  it("no cambia el contenido original", () => {
    const content = withCosts();
    stripContentCosts(content);
    expect(content.thank_you_upsell.cost).toBe(9);
  });

  it("la oferta de gracias viaja sin costo", () => {
    const upsell = publicUpsell(withCosts().thank_you_upsell);
    expect("cost" in upsell).toBe(false);
    expect(upsell.name).toBe("Extra");
  });
});

describe("normalizeContent: opciones nuevas del formulario", () => {
  it("una landing antigua sin requireReference ni las opciones nuevas recibe los valores por defecto", () => {
    const content = createClassicTemplate();
    content.form_blocks = content.form_blocks.map((b) =>
      b.type === "form_fields" ? ({ id: b.id, type: "form_fields", singleNameField: false, askDni: true } as unknown as FormBlock) : b,
    );
    const fields = normalizeContent(content).form_blocks.find((b) => b.type === "form_fields") as Extract<FormBlock, { type: "form_fields" }>;
    expect(fields.requireReference).toBe(true);
    expect(fields.askReference).toBe(true);
    expect(fields.districtSearch).toBe(true);
    expect(fields.privacyNotice.length).toBeGreaterThan(0);
    // Lo que el vendedor ya eligió se respeta
    expect(fields.singleNameField).toBe(false);
    expect(fields.askDni).toBe(true);
  });

  it("respeta un aviso de privacidad vaciado a propósito y una referencia opcional", () => {
    const content = createClassicTemplate();
    content.form_blocks = content.form_blocks.map((b) => (b.type === "form_fields" ? { ...b, privacyNotice: "", requireReference: false } : b));
    const fields = normalizeContent(content).form_blocks.find((b) => b.type === "form_fields") as Extract<FormBlock, { type: "form_fields" }>;
    expect(fields.privacyNotice).toBe("");
    expect(fields.requireReference).toBe(false);
  });

  it("si el bloque no pasa el esquema igual completa lo que falta", () => {
    const content = createClassicTemplate();
    content.form_blocks = content.form_blocks.map((b) =>
      b.type === "form_fields" ? ({ id: b.id, type: "form_fields", privacyNotice: "x".repeat(500) } as unknown as FormBlock) : b,
    );
    const fields = normalizeContent(content).form_blocks.find((b) => b.type === "form_fields") as Extract<FormBlock, { type: "form_fields" }>;
    expect(fields.requireReference).toBe(true);
    expect(fields.privacyNotice).toHaveLength(500);
  });
});
