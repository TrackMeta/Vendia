/**
 * Dominios propios para las landings.
 *  - Dominio de UNA tienda:      fajas.pe/{landing}          → /p/{tienda}/{landing}
 *  - Dominio para TODAS:         mitienda.pe/{tienda}/{landing} → /p/{tienda}/{landing}
 *  - La raíz (fajas.pe/) muestra la landing publicada más reciente de la tienda.
 * El panel de Vendia sigue en el dominio de Vendia.
 */

/** Registros DNS que Vercel pide para un dominio propio. */
export const VERCEL_A_RECORD = "76.76.21.21";
export const VERCEL_CNAME = "cname.vercel-dns.com";
/** Registro TXT que prueba que el dominio es del vendedor: _vendia.<dominio>. */
export const VERIFY_PREFIX = "_vendia";

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

// Segundo nivel genérico: mitienda.com.pe, mitienda.co.uk → el dominio comprado tiene 3 partes
const SECOND_LEVEL = ["com", "net", "org", "edu", "gob", "nom", "co", "ac"];

/** Dominio comprado (sin subdominios): tienda.midominio.com.pe → midominio.com.pe. */
export function registrableDomain(domain: string): string {
  const parts = domain.split(".");
  const size = parts.length >= 3 && SECOND_LEVEL.includes(parts[parts.length - 2]) ? 3 : 2;
  return parts.slice(-size).join(".");
}

/** ¿Es el dominio raíz (tienda.pe) o un subdominio (www.tienda.pe)? Cambia el registro DNS a crear. */
export function isApex(domain: string): boolean {
  return domain === registrableDomain(domain);
}

/** Nombre del registro en el panel del dominio: "@" para la raíz, "a.b" para a.b.midominio.pe. */
export function recordName(domain: string): string {
  const root = registrableDomain(domain);
  return domain === root ? "@" : domain.slice(0, -(root.length + 1));
}

/** Host del registro TXT de verificación. */
export function verifyHost(domain: string): string {
  return `${VERIFY_PREFIX}.${domain}`;
}

/** Valor que debe tener el registro TXT. */
export function verifyValue(token: string): string {
  return `vendia-verify=${token}`;
}

/** Al agregar tienda.pe también se agrega www.tienda.pe (lleva a tienda.pe). */
export function wwwCompanion(domain: string): string | null {
  return isApex(domain) ? `www.${domain}` : null;
}

export type DnsRecord = { type: "A" | "CNAME" | "TXT"; name: string; value: string };

/** Registro principal: A para la raíz, CNAME para un subdominio. */
export function dnsInstructions(domain: string): DnsRecord {
  return isApex(domain) ? { type: "A", name: "@", value: VERCEL_A_RECORD } : { type: "CNAME", name: recordName(domain), value: VERCEL_CNAME };
}

/** Todos los registros que el vendedor debe crear (principal, www si es raíz, y TXT de verificación). */
export function dnsRecords(domain: string, token: string): DnsRecord[] {
  const records: DnsRecord[] = [dnsInstructions(domain)];
  if (isApex(domain)) records.push({ type: "CNAME", name: "www", value: VERCEL_CNAME });
  records.push({ type: "TXT", name: recordName(verifyHost(domain)), value: verifyValue(token) });
  return records;
}

/** CNAME de Vercel: cname.vercel-dns.com o uno propio del proyecto (xxx.vercel-dns-017.com). */
export function isVercelCname(name: string): boolean {
  return /(^|\.)vercel-dns(-\d+)?\.com$/.test(name.toLowerCase().replace(/\.$/, ""));
}

/** ¿Alguno de los TXT (Node los entrega en trozos) tiene el código correcto? */
export function hasVerifyTxt(records: string[][], token: string): boolean {
  const expected = verifyValue(token);
  return records.some((chunks) => chunks.join("").trim() === expected);
}

/** Lo que se encontró en el DNS del dominio (listas vacías = sin registro). */
export type DnsLookup = { cname: string[]; a: string[]; aaaa: string[] };

/**
 * Revisa si el DNS apunta a Vercel.
 *  - Raíz: TODOS los registros A deben ser 76.76.21.21 y no debe haber AAAA.
 *  - Subdominio: CNAME de Vercel, o (igual que la raíz) registros A 76.76.21.21.
 */
export function checkDns(domain: string, found: DnsLookup): { ok: true } | { ok: false; error: string } {
  if (!isApex(domain) && found.cname.some(isVercelCname)) return { ok: true };
  const aOk = found.a.length > 0 && found.a.every((ip) => ip === VERCEL_A_RECORD);
  if (aOk && found.aaaa.length === 0) return { ok: true };
  const expected = dnsInstructions(domain);
  const what = [
    found.cname.length ? `CNAME ${found.cname.join(", ")}` : "",
    found.a.length ? `A ${found.a.join(", ")}` : "",
    found.aaaa.length ? `AAAA ${found.aaaa.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  if (aOk) return { ok: false, error: `Borra los registros AAAA de «${expected.name}» (encontrado: ${what}).` };
  if (found.a.some((ip) => ip === VERCEL_A_RECORD)) {
    return { ok: false, error: `Deja solo el registro A ${VERCEL_A_RECORD}: borra los otros registros A o AAAA (encontrado: ${what}).` };
  }
  return { ok: false, error: `El registro ${expected.type} «${expected.name}» debe apuntar a ${expected.value} (encontrado: ${what || "nada"}).` };
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
    pathname.startsWith("/icons/") ||
    // Archivos (manifest.webmanifest, ubigeo-pe.json…): las landings y tiendas no llevan punto
    /\.[a-z0-9]{1,20}$/i.test(pathname)
  );
}

export type DomainTarget = {
  storeSlug: string | null;
  allStores: boolean;
  /** Landing que se muestra en «/» (null si no hay ninguna publicada). */
  root?: { storeSlug: string; landingSlug: string } | null;
};

/**
 * Ruta interna para un dominio propio.
 * Devuelve null si la ruta no corresponde a una landing (se responde 404).
 * root = true: es la landing principal (ya se revisó en la base que es de ese dominio).
 */
export function rewriteForDomain(pathname: string, target: DomainTarget): { path: string; storeSlug: string; root?: boolean } | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length === 0) {
    return target.root ? { path: `/p/${target.root.storeSlug}/${target.root.landingSlug}`, storeSlug: target.root.storeSlug, root: true } : null;
  }
  if (target.allStores) {
    // /{tienda}/{landing}[/gracias]
    if (parts.length < 2 || parts.length > 3 || (parts.length === 3 && parts[2] !== "gracias")) return null;
    return { path: `/p/${parts.join("/")}`, storeSlug: parts[0] };
  }
  if (!target.storeSlug) return null;
  // /{landing}[/gracias]
  if (parts.length > 2 || (parts.length === 2 && parts[1] !== "gracias")) return null;
  return { path: `/p/${target.storeSlug}/${parts.join("/")}`, storeSlug: target.storeSlug };
}
