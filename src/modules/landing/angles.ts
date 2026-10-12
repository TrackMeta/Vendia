import { type LandingAngle, type LandingContent, MAX_ANGLES, type PageBlock, pageBlock } from "./schema";

/**
 * Ángulos de una landing: la misma página con otros textos e imágenes. Cada ángulo guarda solo
 * lo que cambia por bloque; al mostrarlo se combina con la versión principal.
 */

/** Parámetro del link: /p/tienda/landing?a=acne (corto para los anuncios) */
export const ANGLE_PARAM = "a";
/** Links antiguos (?angulo=acne) siguen funcionando */
const LEGACY_ANGLE_PARAMS = ["angulo"];

/** Clave del ángulo que trae el link (?a= o el antiguo ?angulo=), en minúsculas. */
export function angleKeyFromQuery(query: Record<string, string | string[] | undefined>): string | null {
  for (const param of [ANGLE_PARAM, ...LEGACY_ANGLE_PARAMS]) {
    const value = query[param];
    const first = Array.isArray(value) ? value[0] : value;
    if (typeof first === "string" && first.trim()) return first.trim().toLowerCase();
  }
  return null;
}

export function findAngle(content: LandingContent, key: string | null | undefined): LandingAngle | null {
  if (!key) return null;
  return (content.angles ?? []).find((a) => a.key === key) ?? null;
}

/** Un bloque con los cambios del ángulo (si el resultado no es válido, se queda el principal). */
export function mergeBlock(block: PageBlock, angle: LandingAngle | null): PageBlock {
  const fields = angle?.overrides[block.id];
  if (!fields || !Object.keys(fields).length) return block;
  const merged = pageBlock.safeParse({ ...block, ...fields, id: block.id, type: block.type });
  return merged.success ? merged.data : block;
}

/** El contenido tal como lo ve quien llega por ese ángulo. */
export function applyAngle(content: LandingContent, key: string | null | undefined): LandingContent {
  const angle = findAngle(content, key);
  if (!angle) return content;
  return { ...content, page_blocks: content.page_blocks.map((b) => mergeBlock(b, angle)) };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Guarda en el ángulo lo que el usuario cambió en un bloque: solo los campos distintos de la
 * versión principal. Si quedó igual a la principal, el bloque deja de tener cambios.
 */
export function setBlockOverride(content: LandingContent, key: string, edited: PageBlock): LandingContent {
  const base = content.page_blocks.find((b) => b.id === edited.id);
  if (!base) return content;
  const diff: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(edited)) {
    if (field === "id" || field === "type") continue;
    if (!same(value, (base as Record<string, unknown>)[field])) diff[field] = value;
  }
  return {
    ...content,
    angles: content.angles.map((a) => {
      if (a.key !== key) return a;
      const overrides = { ...a.overrides };
      if (Object.keys(diff).length) overrides[edited.id] = diff;
      else delete overrides[edited.id];
      return { ...a, overrides };
    }),
  };
}

/** Vuelve un bloque del ángulo a como está en la versión principal. */
export function clearBlockOverride(content: LandingContent, key: string, blockId: string): LandingContent {
  return {
    ...content,
    angles: content.angles.map((a) => {
      if (a.key !== key) return a;
      const overrides = { ...a.overrides };
      delete overrides[blockId];
      return { ...a, overrides };
    }),
  };
}

/** Bloques que cambian en el ángulo (y que todavía existen en la página). */
export function changedBlockIds(content: LandingContent, key: string | null): Set<string> {
  const angle = findAngle(content, key);
  if (!angle) return new Set();
  const ids = new Set(content.page_blocks.map((b) => b.id));
  return new Set(Object.entries(angle.overrides).filter(([id, f]) => ids.has(id) && Object.keys(f).length).map(([id]) => id));
}

/** «Dolor de espalda» → «dolor-de-espalda» (único entre los ángulos de la landing). */
export function angleKeyFrom(name: string, existing: string[]): string {
  const base =
    name
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 36)
      .replace(/-+$/g, "") || "angulo";
  let key = base;
  for (let n = 2; existing.includes(key); n++) key = `${base}-${n}`;
  return key;
}

/** Agrega un ángulo nuevo (empieza igual a la versión principal). */
export function addAngle(content: LandingContent, name: string): { content: LandingContent; key: string } | null {
  if ((content.angles ?? []).length >= MAX_ANGLES) return null;
  const key = angleKeyFrom(name, (content.angles ?? []).map((a) => a.key));
  return { content: { ...content, angles: [...(content.angles ?? []), { key, name: name.trim().slice(0, 60) || key, overrides: {} }] }, key };
}

/** Nombre del ángulo para los números: el del ángulo o, en la versión principal, el de la landing. */
export function angleName(content: LandingContent, key: string | null | undefined, landingAngle: string | null | undefined): string | null {
  return findAngle(content, key)?.name ?? (landingAngle?.trim() || null);
}
