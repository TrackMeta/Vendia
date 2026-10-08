/**
 * Pruebas A/B de landings: el visitante cae en una variante según su peso
 * y siempre ve la misma (cookie). La redirección conserva los UTM del anuncio.
 */
export type AbVariant = { slug: string; weight: number };

export const abCookieName = (landingId: string) => `vab_${landingId.replace(/-/g, "").slice(0, 20)}`;

/** Elige una variante según su peso (r entre 0 y 1). Si todos los pesos son 0, reparte en partes iguales. */
export function pickVariant(variants: AbVariant[], r: number = Math.random()): string | null {
  const valid = variants.filter((v) => v.slug);
  if (!valid.length) return null;
  const total = valid.reduce((s, v) => s + Math.max(0, v.weight), 0);
  if (total <= 0) return valid[Math.min(valid.length - 1, Math.floor(r * valid.length))].slug;
  let acc = 0;
  for (const v of valid) {
    acc += Math.max(0, v.weight) / total;
    if (r < acc) return v.slug;
  }
  return valid[valid.length - 1].slug;
}

/** URL de la variante conservando la query del anuncio (utm, fbclid…) y marcando de qué prueba viene. */
export function variantUrl(storeSlug: string, variantSlug: string, query: Record<string, string | string[] | undefined>, mainLandingId: string): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (typeof v === "string") sp.set(k, v);
    else if (Array.isArray(v)) v.forEach((x) => sp.append(k, x));
  }
  sp.set("vab", mainLandingId);
  return `/p/${storeSlug}/${variantSlug}?${sp.toString()}`;
}
