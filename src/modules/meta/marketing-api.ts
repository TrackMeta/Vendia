/**
 * Meta Marketing API (solo lectura de campañas + crear/leer Pixels + darse acceso a cuentas del Business Manager).
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

/**
 * assigned: el token ya tiene acceso. Si es false, la cuenta es de su Business Manager pero aún no
 * está asignada al usuario del sistema: Vendia puede darse acceso (grantAdAccountAccess) con businessId.
 */
export type AdAccount = { id: string; name: string; currency: string; status: number; business: string | null; businessId: string | null; assigned: boolean };

type RawAccount = { id: string; name: string; currency: string; account_status: number; business?: { id?: string; name: string } };
const ACCOUNT_FIELDS = "id,name,currency,account_status,business{id,name}";

/** Valida el token y lista sus cuentas publicitarias: las asignadas y las de sus Business Managers que aún no lo están. */
/**
 * Negocios a los que pertenece el token según Meta (debug_token → granular_scopes de business_management).
 * Sirve cuando el usuario del sistema aún no tiene ninguna cuenta asignada. Nunca lanza.
 */
async function businessesFromToken(token: string, f: Fetch): Promise<string[]> {
  try {
    const r = await graph<{ data?: { granular_scopes?: { scope: string; target_ids?: string[] }[] } }>(f, "debug_token", token, { input_token: token });
    return (r.data?.granular_scopes ?? []).filter((g) => g.scope === "business_management").flatMap((g) => g.target_ids ?? []);
  } catch {
    return [];
  }
}

export async function inspectToken(
  token: string,
  f: Fetch = fetch,
  /** ID del Business Manager escrito por el vendedor, si Meta no nos dice cuál es. */
  extraBusinessId?: string,
): Promise<{ userId: string; userName: string; accounts: AdAccount[] }> {
  const me = await graph<{ id: string; name?: string }>(f, "me", token, { fields: "id,name" });
  const mine = await all<RawAccount>(f, "me/adaccounts", token, { fields: ACCOUNT_FIELDS, limit: "100" });
  const accounts: AdAccount[] = mine.map((a) => ({
    id: a.id,
    name: a.name,
    currency: a.currency,
    status: a.account_status,
    business: a.business?.name ?? null,
    businessId: a.business?.id ?? null,
    assigned: true,
  }));

  // Business Managers del token: los de sus cuentas, los que lista /me/businesses, los que dice debug_token
  // y el que escribió el vendedor (cualquiera sirve para encontrar las cuentas aún no asignadas)
  const businesses = new Map<string, string>();
  for (const a of accounts) if (a.businessId) businesses.set(a.businessId, a.business ?? "");
  const listed = await all<{ id: string; name: string }>(f, "me/businesses", token, { fields: "id,name", limit: "50" }).catch(() => []);
  for (const b of listed) businesses.set(b.id, b.name);
  for (const id of await businessesFromToken(token, f)) if (!businesses.has(id)) businesses.set(id, "");
  if (extraBusinessId && !businesses.has(extraBusinessId)) businesses.set(extraBusinessId, "");

  // Cuentas de esos Business Managers que el usuario del sistema todavía no tiene asignadas
  const seen = new Set(accounts.map((a) => a.id));
  for (const [businessId, businessName] of businesses) {
    for (const edge of ["owned_ad_accounts", "client_ad_accounts"]) {
      const rows = await all<RawAccount>(f, `${businessId}/${edge}`, token, { fields: ACCOUNT_FIELDS, limit: "100" }).catch(() => []);
      for (const r of rows) {
        if (seen.has(r.id)) continue;
        seen.add(r.id);
        accounts.push({ id: r.id, name: r.name, currency: r.currency, status: r.account_status, business: r.business?.name ?? businessName, businessId, assigned: false });
      }
    }
  }
  return { userId: me.id, userName: me.name ?? me.id, accounts };
}

/**
 * Vendia se asigna una cuenta publicitaria del Business Manager (para que no tengas que ir a
 * «Usuarios del sistema» cada vez que creas una cuenta). Meta solo lo permite si el usuario del
 * sistema es Administrador del Business Manager.
 */
export async function grantAdAccountAccess(token: string, adAccountId: string, businessId: string, userId: string, f: Fetch = fetch): Promise<void> {
  await graph<{ success?: boolean }>(
    f,
    `${adAccountId}/assigned_users`,
    token,
    { user: userId, business: businessId, tasks: JSON.stringify(["MANAGE", "ADVERTISE", "ANALYZE"]) },
    "POST",
  );
}

/** Quita lo que se suele pegar de más: espacios, saltos de línea, comillas o «Bearer». */
export function cleanToken(raw: string): string {
  return raw
    .replace(/["'`]/g, "")
    .trim()
    .replace(/^bearer\s+/i, "")
    .replace(/\s/g, "");
}

/** Permisos que Meta le concedió al token (para decir exactamente cuál falta). */
export async function tokenPermissions(token: string, f: Fetch = fetch): Promise<string[]> {
  const r = await graph<{ data: { permission: string; status: string }[] }>(f, "me/permissions", token);
  return r.data.filter((p) => p.status === "granted").map((p) => p.permission);
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
