/** Tipografías de las landings (compartido entre servidor y cliente). */
export const FONT_STACK: Record<string, string> = {
  system: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  Poppins: "'Poppins', system-ui, sans-serif",
  Montserrat: "'Montserrat', system-ui, sans-serif",
  Inter: "'Inter', system-ui, sans-serif",
  Roboto: "'Roboto', system-ui, sans-serif",
};

export function googleFontHref(font: string): string | null {
  if (font === "system" || !(font in FONT_STACK)) return null;
  return `https://fonts.googleapis.com/css2?family=${encodeURIComponent(font)}:wght@400;600;700;800;900&display=swap`;
}
