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
