import { describe, expect, it } from "vitest";
import { addAngle, angleKeyFrom, angleName, applyAngle, changedBlockIds, clearBlockOverride, setBlockOverride, angleKeyFromQuery } from "./angles";
import { createTemplate } from "./defaults";
import { landingContent, type PageBlock } from "./schema";

const heading = (c: ReturnType<typeof createTemplate>) => c.page_blocks.find((b) => b.type === "heading") as Extract<PageBlock, { type: "heading" }>;

describe("Ángulos de una landing", () => {
  it("cada ángulo cambia solo sus textos; lo demás queda igual", () => {
    let c = createTemplate("packs");
    const added = addAngle(c, "Acné juvenil")!;
    expect(added.key).toBe("acne-juvenil");
    c = setBlockOverride(added.content, added.key, { ...heading(added.content), text: "¿Granitos que no se van?" });

    expect(heading(applyAngle(c, "acne-juvenil")).text).toBe("¿Granitos que no se van?");
    expect(heading(applyAngle(c, null)).text).toBe(heading(c).text); // versión principal intacta
    expect(applyAngle(c, "no-existe")).toBe(c);
    // solo se guardó el campo que cambió
    expect(Object.keys(c.angles[0].overrides[heading(c).id])).toEqual(["text"]);
    expect(changedBlockIds(c, "acne-juvenil")).toEqual(new Set([heading(c).id]));
  });

  it("si el bloque vuelve a ser igual al principal, deja de tener cambios", () => {
    let c = addAngle(createTemplate("packs"), "Manchas")!.content;
    c = setBlockOverride(c, "manchas", { ...heading(c), text: "Otro" });
    c = setBlockOverride(c, "manchas", heading(c));
    expect(c.angles[0].overrides).toEqual({});
    c = setBlockOverride(c, "manchas", { ...heading(c), text: "Otro" });
    expect(clearBlockOverride(c, "manchas", heading(c).id).angles[0].overrides).toEqual({});
  });

  it("etiquetas únicas y limpias para el link", () => {
    expect(angleKeyFrom("Dolor de Espalda!", [])).toBe("dolor-de-espalda");
    expect(angleKeyFrom("Acné", ["acne"])).toBe("acne-2");
    expect(angleKeyFrom("¡¡!!", [])).toBe("angulo");
  });

  it("el contenido con ángulos se valida al guardar", () => {
    let c = addAngle(createTemplate("packs"), "Acné")!.content;
    c = setBlockOverride(c, "acne", { ...heading(c), text: "Texto nuevo" });
    expect(landingContent.safeParse(c).success).toBe(true);
    const broken = { ...c, angles: [{ ...c.angles[0], overrides: { [heading(c).id]: { size: "gigante" } } }] };
    expect(landingContent.safeParse(broken).success).toBe(false);
    const dup = { ...c, angles: [c.angles[0], { ...c.angles[0] }] };
    expect(landingContent.safeParse(dup).success).toBe(false);
  });

  it("nombre del ángulo para los números", () => {
    const c = addAngle(createTemplate("packs"), "Acné")!.content;
    expect(angleName(c, "acne", "Manchas")).toBe("Acné");
    expect(angleName(c, null, "Manchas")).toBe("Manchas");
    expect(angleName(c, null, "")).toBeNull();
  });
});

describe("Link del ángulo", () => {
  it("lee ?a= y el antiguo ?angulo=", () => {
    expect(angleKeyFromQuery({ a: "Acne" })).toBe("acne");
    expect(angleKeyFromQuery({ angulo: "acne" })).toBe("acne");
    expect(angleKeyFromQuery({ a: "manchas", angulo: "acne" })).toBe("manchas");
    expect(angleKeyFromQuery({ a: ["acne", "x"] })).toBe("acne");
    expect(angleKeyFromQuery({ utm_source: "facebook" })).toBeNull();
  });
});
