/**
 * Dominios propios para las landings.
 *  - Dominio de UNA tienda:      fajas.pe/{landing}          → /p/{tienda}/{landing}
 *  - Dominio para TODAS:         mitienda.pe/{tienda}/{landing} → /p/{tienda}/{landing}
 * El panel de Vendia sigue en el dominio de Vendia.
 */

/** Registros DNS que Vercel pide para un dominio propio. */
export const VERCEL_A_RECORD = "76.76.21.21";
export const VERCEL_CNAME = "cname.vercel-dns.com";

/** Normaliza lo que escribe el usuario ("https://www.MiTienda.pe/") → "www.mitienda.pe". */
export function normalizeDomain(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "")
    .replace(/\.$/, "");
}

const DOMAIN_RE = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/;

export function isValidDomain(domain: string): boolean {
  return domain.length <= 253 && DOMAIN_RE.test(domain);
}

/** ¿Es un subdominio (www.tienda.pe) o el dominio raíz (tienda.pe)? Cambia el registro DNS a crear. */
export function isApex(domain: string): boolean {
  const parts = domain.split(".");
  // Dominios .com.pe / .org.pe: el raíz tiene 3 partes
  const secondLevel = parts.length >= 3 && ["com", "org", "net", "edu", "gob", "nom"].includes(parts[parts.length - 2]);
  return parts.length === (secondLevel ? 3 : 2);
}

/** Instrucciones DNS para el dominio. */
export function dnsInstructions(domain: string) {
  return isApex(domain)
    ? { type: "A" as const, name: "@", value: VERCEL_A_RECORD }
    : { type: "CNAME" as const, name: domain.split(".")[0], value: VERCEL_CNAME };
}

/** Hosts que son el propio Vendia (panel, previews de Vercel y local): no se reescriben. */
export function isAppHost(host: string, appUrl: string | undefined): boolean {
  const h = host.toLowerCase().replace(/:\d+$/, "");
  if (h === "localhost" || h === "127.0.0.1" || h.endsWith(".localhost") || h.endsWith(".vercel.app")) return true;
  try {
    const app = appUrl ? new URL(appUrl).hostname.toLowerCase() : null;
    return Boolean(app && (h === app || h === `www.${app}`));
  } catch {
    return false;
  }
}

/** Rutas que se sirven igual en cualquier dominio (API, archivos, la landing con su ruta normal). */
export function isPassthroughPath(pathname: string): boolean {
  return (
    pathname.startsWith("/api/") ||
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/p/") ||
    pathname.startsWith("/couriers/") ||
    /\.[a-z0-9]{2,5}$/i.test(pathname)
  );
}

/**
 * Ruta interna para un dominio propio.
 * Devuelve null si la ruta no corresponde a una landing (se responde 404).
 */
export function rewriteForDomain(pathname: string, target: { storeSlug: string | null; allStores: boolean }): { path: string; storeSlug: string } | null {
  const parts = pathname.split("/").filter(Boolean);
  if (target.allStores) {
    // /{tienda}/{landing}[/gracias]
    if (parts.length < 2 || parts.length > 3 || (parts.length === 3 && parts[2] !== "gracias")) return null;
    return { path: `/p/${parts.join("/")}`, storeSlug: parts[0] };
  }
  if (!target.storeSlug) return null;
  // /{landing}[/gracias]
  if (parts.length < 1 || parts.length > 2 || (parts.length === 2 && parts[1] !== "gracias")) return null;
  return { path: `/p/${target.storeSlug}/${parts.join("/")}`, storeSlug: target.storeSlug };
}
