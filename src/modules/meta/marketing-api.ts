/**
 * Meta Marketing API (solo lectura de campañas + crear/leer Pixels).
 * Vendia NUNCA modifica campañas, conjuntos ni anuncios.
 * El token es de un usuario del sistema del Business Manager del vendedor
 * (ads_read + ads_management + business_management) y se guarda cifrado.
 */
import { META_GRAPH_VERSION } from "./events";

export class MetaApiError extends Error {
  constructor(
    message: string,
    public code?: number,
  ) {
    super(message);
  }
}

type Fetch = typeof fetch;
const BASE = `https://graph.facebook.com/${META_GRAPH_VERSION}`;

/** Traduce los errores más comunes de Meta a algo que el vendedor entienda. */
export function friendlyMetaError(code: number | undefined, message: string): string {
  if (code === 190) return "El token no es válido o expiró. Genera uno nuevo en tu Business Manager (usuario del sistema).";
  if (code === 10 || code === 200 || code === 294) return "Al token le faltan permisos: necesita ads_read, ads_management y business_management.";
  if (code === 17 || code === 4 || code === 613) return "Meta limitó las consultas por un momento. Vuelve a intentar en unos minutos.";
  if (code === 100) return `Meta rechazó la consulta: ${message}`;
  return message || "Meta no respondió correctamente";
}

async function graph<T>(f: Fetch, path: string, token: string, params: Record<string, string> = {}, method: "GET" | "POST" = "GET"): Promise<T> {
  const url = new URL(path.startsWith("http") ? path : `${BASE}/${path}`);
  const body = new URLSearchParams({ ...params, access_token: token });
  let res: Response;
  try {
    res =
      method === "GET"
        ? await f(path.startsWith("http") ? path : `${url.toString()}?${body.toString()}`, { signal: AbortSignal.timeout(20_000) })
        : await f(url.toString(), { method: "POST", body, signal: AbortSignal.timeout(20_000) });
  } catch {
    throw new MetaApiError("No se pudo conectar con Meta");
  }
  const json = (await res.json().catch(() => ({}))) as T & { error?: { message?: string; code?: number } };
  if (!res.ok || json.error) throw new MetaApiError(friendlyMetaError(json.error?.code, json.error?.message ?? `HTTP ${res.status}`), json.error?.code);
  return json;
}

/** Recorre todas las páginas de un listado (paging.next ya incluye el token). */
async function all<T>(f: Fetch, path: string, token: string, params: Record<string, string>, max = 5000): Promise<T[]> {
  const out: T[] = [];
  let page = await graph<{ data: T[]; paging?: { next?: string } }>(f, path, token, params);
  out.push(...page.data);
  while (page.paging?.next && out.length < max) {
    page = await graph<{ data: T[]; paging?: { next?: string } }>(f, page.paging.next, token);
    out.push(...page.data);
  }
  return out;
}

export type AdAccount = { id: string; name: string; currency: string; status: number; business: string | null };

/** Valida el token y lista sus cuentas publicitarias (con moneda). */
export async function inspectToken(token: string, f: Fetch = fetch): Promise<{ userName: string; accounts: AdAccount[] }> {
  const me = await graph<{ id: string; name?: string }>(f, "me", token, { fields: "id,name" });
  const accounts = await all<{ id: string; name: string; currency: string; account_status: number; business?: { name: string } }>(f, "me/adaccounts", token, {
    fields: "id,name,currency,account_status,business{name}",
    limit: "100",
  });
  return {
    userName: me.name ?? me.id,
    accounts: accounts.map((a) => ({ id: a.id, name: a.name, currency: a.currency, status: a.account_status, business: a.business?.name ?? null })),
  };
}

export type Pixel = { id: string; name: string; lastFired: string | null };

export async function listPixels(token: string, adAccountId: string, f: Fetch = fetch): Promise<Pixel[]> {
  const rows = await all<{ id: string; name: string; last_fired_time?: string }>(f, `${adAccountId}/adspixels`, token, { fields: "id,name,last_fired_time", limit: "50" });
  return rows.map((p) => ({ id: p.id, name: p.name, lastFired: p.last_fired_time ?? null }));
}

export async function createPixel(token: string, adAccountId: string, name: string, f: Fetch = fetch): Promise<string> {
  const r = await graph<{ id: string }>(f, `${adAccountId}/adspixels`, token, { name }, "POST");
  return r.id;
}

export type InsightRow = {
  date: string;
  campaignId: string;
  campaignName: string;
  adsetId: string;
  adsetName: string;
  adId: string;
  adName: string;
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  /** Resultados de Meta: leads (Pixel o formulario). */
  results: number;
};

const LEAD_ACTIONS = ["lead", "offsite_conversion.fb_pixel_lead", "onsite_conversion.lead_grouped"];

/** Leads reportados por Meta: el mayor entre los tipos de acción de lead (no se suman: se solapan). */
export function leadsFrom(actions: { action_type: string; value: string }[] | undefined): number {
  if (!actions) return 0;
  return Math.max(0, ...actions.filter((a) => LEAD_ACTIONS.includes(a.action_type)).map((a) => Number(a.value) || 0));
}

/** Métricas por anuncio y por día. */
export async function fetchInsights(token: string, adAccountId: string, since: string, until: string, f: Fetch = fetch): Promise<InsightRow[]> {
  const rows = await all<{
    date_start: string;
    campaign_id: string;
    campaign_name: string;
    adset_id: string;
    adset_name: string;
    ad_id: string;
    ad_name: string;
    spend?: string;
    impressions?: string;
    reach?: string;
    inline_link_clicks?: string;
    actions?: { action_type: string; value: string }[];
  }>(f, `${adAccountId}/insights`, token, {
    level: "ad",
    time_increment: "1",
    time_range: JSON.stringify({ since, until }),
    fields: "date_start,campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,spend,impressions,reach,inline_link_clicks,actions",
    limit: "500",
  });
  return rows.map((r) => ({
    date: r.date_start,
    campaignId: r.campaign_id,
    campaignName: r.campaign_name,
    adsetId: r.adset_id,
    adsetName: r.adset_name,
    adId: r.ad_id,
    adName: r.ad_name,
    spend: Number(r.spend ?? 0),
    impressions: Number(r.impressions ?? 0),
    reach: Number(r.reach ?? 0),
    clicks: Number(r.inline_link_clicks ?? 0),
    results: leadsFrom(r.actions),
  }));
}

export type AdCreative = { id: string; status: string | null; thumbnailUrl: string | null; body: string | null; title: string | null; previewUrl: string | null };

/** Creatividad de los anuncios (miniatura, texto y enlace para verlo), de 50 en 50. */
export async function fetchAdCreatives(token: string, adIds: string[], f: Fetch = fetch): Promise<AdCreative[]> {
  const out: AdCreative[] = [];
  for (let i = 0; i < adIds.length; i += 50) {
    const ids = adIds.slice(i, i + 50);
    const r = await graph<
      Record<
        string,
        {
          id: string;
          effective_status?: string;
          preview_shareable_link?: string;
          creative?: { thumbnail_url?: string; image_url?: string; body?: string; title?: string };
        }
      >
    >(f, "", token, { ids: ids.join(","), fields: "id,effective_status,preview_shareable_link,creative{thumbnail_url,image_url,body,title}" });
    for (const ad of Object.values(r)) {
      out.push({
        id: ad.id,
        status: ad.effective_status ?? null,
        thumbnailUrl: ad.creative?.thumbnail_url ?? ad.creative?.image_url ?? null,
        body: ad.creative?.body ?? null,
        title: ad.creative?.title ?? null,
        previewUrl: ad.preview_shareable_link ?? null,
      });
    }
  }
  return out;
}
