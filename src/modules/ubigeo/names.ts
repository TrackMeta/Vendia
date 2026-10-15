const LOWERCASE_WORDS = new Set(["de", "del", "la", "las", "los", "el", "y", "e", "en"]);

/** "SAN JUAN DE LURIGANCHO" → "San Juan de Lurigancho" */
export function toDisplayName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((word, index) => {
      if (index > 0 && LOWERCASE_WORDS.has(word)) return word;
      return word
        .split("-")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join("-");
    })
    .join(" ");
}

/** Normaliza para búsqueda: minúsculas y sin tildes. */
export function normalizeForSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/** Coincidencias de lo escrito (sin importar tildes): primero las que empiezan así, después las que lo contienen. */
export function filterOptions<T extends { name: string }>(options: T[], text: string): T[] {
  const q = normalizeForSearch(text);
  if (!q) return options;
  const starts: T[] = [];
  const contains: T[] = [];
  for (const o of options) {
    const key = normalizeForSearch(o.name);
    if (key.startsWith(q)) starts.push(o);
    else if (key.includes(q)) contains.push(o);
  }
  return [...starts, ...contains];
}
