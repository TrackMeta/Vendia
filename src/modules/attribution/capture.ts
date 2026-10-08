/**
 * Captura de atribución en el navegador (landing pública).
 * Guarda UTMs, fbclid e IDs de campaña/conjunto/anuncio en una cookie propia
 * por 7 días, para no perderlos si el cliente navega o vuelve más tarde.
 */

export type Attribution = {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
  fbclid?: string;
  fbc?: string;
  fbp?: string;
  campaign_id?: string;
  adset_id?: string;
  ad_id?: string;
  referrer?: string;
  landing_url?: string;
};

const COOKIE = "vd_attr";
const MAX_AGE = 60 * 60 * 24 * 7;
export const TRACKED_PARAMS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "fbclid",
  "campaign_id",
  "adset_id",
  "ad_id",
] as const;

function readCookie(name: string): string | undefined {
  const match = document.cookie.split("; ").find((row) => row.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : undefined;
}

function writeCookie(name: string, value: string, maxAge: number) {
  const secure = location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${name}=${encodeURIComponent(value)}; Max-Age=${maxAge}; Path=/; SameSite=Lax${secure}`;
}

/** Extrae los parámetros de seguimiento de una URL (función pura, testeable). */
export function paramsFromUrl(search: string): Partial<Attribution> {
  const params = new URLSearchParams(search);
  const result: Partial<Attribution> = {};
  for (const key of TRACKED_PARAMS) {
    const value = params.get(key);
    if (value) result[key] = value.slice(0, 500);
  }
  return result;
}

/** fbc según Meta: fb.1.<timestamp ms>.<fbclid> (sin cambiar mayúsculas del fbclid). */
export function buildFbc(fbclid: string, now = Date.now()): string {
  return `fb.1.${now}.${fbclid}`;
}

/** Llamar al cargar la landing. Último clic con parámetros gana. */
export function captureAttribution(): void {
  try {
    const fromUrl = paramsFromUrl(location.search);
    const hasNewParams = Object.keys(fromUrl).length > 0;
    const stored = readCookie(COOKIE);

    if (hasNewParams || !stored) {
      const data: Attribution = {
        ...fromUrl,
        referrer: document.referrer ? document.referrer.slice(0, 500) : undefined,
        landing_url: location.href.slice(0, 1000),
      };
      writeCookie(COOKIE, JSON.stringify(data), MAX_AGE);
    }

    // Cookie _fbc (la usa Meta). Si el Pixel aún no está instalado, la creamos nosotros.
    if (fromUrl.fbclid) {
      const current = readCookie("_fbc");
      if (!current || !current.endsWith(`.${fromUrl.fbclid}`)) {
        writeCookie("_fbc", buildFbc(fromUrl.fbclid), 60 * 60 * 24 * 90);
      }
    }
  } catch {
    // Nunca romper la landing por la atribución.
  }
}

/** Lee la atribución guardada + cookies de Meta, para enviar con el pedido. */
export function readAttribution(): Attribution {
  try {
    const stored = readCookie(COOKIE);
    const data: Attribution = stored ? JSON.parse(stored) : {};
    return { ...data, fbc: readCookie("_fbc") ?? data.fbc, fbp: readCookie("_fbp") };
  } catch {
    return {};
  }
}
