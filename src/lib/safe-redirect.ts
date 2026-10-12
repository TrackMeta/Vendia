/**
 * Destino seguro después de ingresar (?next=): solo rutas de Vendia.
 * «//otro.com» y «/\otro.com» los navegadores los abren como otro dominio: se rechazan.
 */
export function safeRedirectPath(value: unknown, fallback = "/dashboard"): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.length > 500) return fallback;
  if (/^\/[/\\]/.test(value) || /[\\\u0000-\u001f]/.test(value)) return fallback;
  try {
    const base = "http://vendia.local";
    const url = new URL(value, base);
    if (url.origin !== base) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}
