import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { after } from "next/server";
import { decryptSecret } from "@/lib/crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { IGV_RATE, toPen } from "@/modules/expenses/categories";
import { addDays, limaToday } from "@/modules/metrics/date-range";
import { fetchAdCreatives, fetchInsights, type InsightRow, MetaApiError } from "./marketing-api";
import { DEFAULT_SYNC_MINUTES, isSyncDue, parseSyncInterval, TOLERANCE_MINUTES } from "./schedule";

export type SyncResult =
  | { ok: true; rows: number; spend: number; since: string; until: string; accounts: number; failed: { account: string; error: string }[] }
  | { ok: false; error: string };

/** Días que se vuelven a pedir: Meta ajusta las cifras de los últimos días. */
export const DAILY_SYNC_DAYS = 3;
export const FIRST_SYNC_DAYS = 30;
/** Las lecturas programadas traen hoy y ayer (la de la mañana trae 3 días). */
const SCHEDULED_SYNC_DAYS = 2;

type Account = { ad_account_id: string; name: string | null; currency: string | null };
type AccountResult = { ok: true; rows: number; spend: number } | { ok: false; error: string };

/**
 * Una cuenta publicitaria: trae de Meta las métricas por anuncio y por día, y
 *  1. guarda campañas, conjuntos y anuncios (con su creatividad),
 *  2. guarda las métricas diarias con el gasto en soles (TC de la tienda si la cuenta es en dólares),
 *  3. registra el gasto como «Meta Ads» por campaña y día (reemplaza al CSV en esos días).
 * Solo toca los datos de esta cuenta: si otra falla, la suya queda intacta.
 */
async function syncAccount(
  admin: SupabaseClient,
  storeId: string,
  token: string,
  account: Account,
  since: string,
  until: string,
  settings: { usd_rate: number | null; apply_igv: boolean | null } | null,
  f: typeof fetch,
): Promise<AccountResult> {
  const acct = account.ad_account_id;
  const usd = account.currency === "USD";
  const rate = usd ? Number(settings?.usd_rate ?? 1) : 1;
  const igv = settings?.apply_igv ? IGV_RATE : 0;

  let rows: InsightRow[];
  try {
    rows = await fetchInsights(token, acct, since, until, f);
  } catch (e) {
    return { ok: false, error: e instanceof MetaApiError ? e.message : "No se pudo leer las métricas de Meta" };
  }

  // 1. Campañas, conjuntos y anuncios
  const entities = new Map<string, Record<string, unknown>>();
  const now = new Date().toISOString();
  for (const r of rows) {
    entities.set(r.campaignId, { store_id: storeId, id: r.campaignId, level: "campaign", name: r.campaignName, ad_account_id: acct, updated_at: now });
    entities.set(r.adsetId, { store_id: storeId, id: r.adsetId, level: "adset", name: r.adsetName, campaign_id: r.campaignId, ad_account_id: acct, updated_at: now });
    entities.set(r.adId, {
      store_id: storeId,
      id: r.adId,
      level: "ad",
      name: r.adName,
      campaign_id: r.campaignId,
      adset_id: r.adsetId,
      ad_account_id: acct,
      updated_at: now,
    });
  }
  const adIds = [...new Set(rows.map((r) => r.adId))];
  try {
    for (const c of await fetchAdCreatives(token, adIds, f)) {
      const e = entities.get(c.id);
      if (e) Object.assign(e, { status: c.status, thumbnail_url: c.thumbnailUrl, body: c.body?.slice(0, 3000) ?? null, title: c.title?.slice(0, 400) ?? null, preview_url: c.previewUrl });
    }
  } catch {
    // La creatividad es un extra: si falla, igual se guardan las métricas
  }
  if (entities.size) {
    const { error } = await admin.from("meta_entities").upsert([...entities.values()], { onConflict: "store_id,id" });
    if (error) return { ok: false, error: "No se pudieron guardar las campañas" };
  }

  // 2. Métricas diarias de esta cuenta (se reemplaza el rango: si un anuncio quedó en 0, desaparece)
  await admin.from("meta_insights_daily").delete().eq("store_id", storeId).eq("ad_account_id", acct).gte("date", since).lte("date", until);
  if (rows.length) {
    const { error } = await admin.from("meta_insights_daily").insert(
      rows.map((r) => ({
        store_id: storeId,
        ad_account_id: acct,
        date: r.date,
        ad_id: r.adId,
        adset_id: r.adsetId,
        campaign_id: r.campaignId,
        spend: r.spend,
        spend_pen: toPen(r.spend, rate, igv),
        impressions: r.impressions,
        reach: r.reach,
        clicks: r.clicks,
        results: r.results,
        updated_at: now,
      })),
    );
    if (error) return { ok: false, error: "No se pudieron guardar las métricas" };
  }

  // 3. Gasto por campaña y día
  const byDay = new Map<string, { date: string; campaignId: string; campaignName: string; amount: number }>();
  for (const r of rows) {
    const key = `${r.date}:${r.campaignId}`;
    const cur = byDay.get(key) ?? { date: r.date, campaignId: r.campaignId, campaignName: r.campaignName, amount: 0 };
    cur.amount += r.spend;
    byDay.set(key, cur);
  }
  const campaignIds = [...new Set(rows.map((r) => r.campaignId))];
  // Todas las campañas conocidas de esta cuenta (también las que hoy quedaron en 0)
  const { data: known } = await admin.from("meta_entities").select("id").eq("store_id", storeId).eq("ad_account_id", acct).eq("level", "campaign");
  const accountCampaigns = [...new Set([...campaignIds, ...(known ?? []).map((k) => k.id as string)])];
  // Producto de cada campaña: el último que el vendedor le asignó a mano o al importar
  const { data: mapped } = campaignIds.length
    ? await admin.from("expenses").select("campaign_id, product_id").eq("store_id", storeId).in("campaign_id", campaignIds).not("product_id", "is", null).order("created_at", { ascending: false })
    : { data: [] as { campaign_id: string; product_id: string }[] };
  const productOf = new Map<string, string>();
  for (const m of mapped ?? []) if (!productOf.has(m.campaign_id)) productOf.set(m.campaign_id, m.product_id);

  if (accountCampaigns.length) {
    await admin
      .from("expenses")
      .delete()
      .eq("store_id", storeId)
      .eq("source", "meta_sync")
      .in("campaign_id", accountCampaigns)
      .gte("expense_date", since)
      .lte("expense_date", until);
  }
  // El CSV de esos días queda reemplazado por la sincronización (evita contar dos veces)
  if (campaignIds.length) {
    await admin
      .from("expenses")
      .delete()
      .eq("store_id", storeId)
      .eq("source", "import")
      .eq("category", "meta_ads")
      .in("campaign_id", campaignIds)
      .gte("expense_date", since)
      .lte("expense_date", until);
  }
  const expenses = [...byDay.values()]
    .filter((d) => d.amount > 0)
    .map((d) => ({
      store_id: storeId,
      expense_date: d.date,
      category: "meta_ads",
      description: `Meta Ads · ${d.campaignName}`.slice(0, 300),
      amount: Math.round(d.amount * 100) / 100,
      currency: usd ? "USD" : "PEN",
      exchange_rate: rate,
      igv_rate: igv,
      campaign_id: d.campaignId,
      campaign_name: d.campaignName.slice(0, 255),
      product_id: productOf.get(d.campaignId) ?? null,
      source: "meta_sync",
      import_key: `meta:${d.date}:${d.campaignId}`,
    }));
  if (expenses.length) {
    const { error } = await admin.from("expenses").upsert(expenses, { onConflict: "store_id,import_key" });
    if (error) return { ok: false, error: "No se pudo registrar el gasto de Meta" };
  }

  const spend = Math.round(rows.reduce((s, r) => s + toPen(r.spend, rate, igv), 0) * 100) / 100;
  return { ok: true, rows: rows.length, spend };
}

/**
 * Sincroniza todas las cuentas publicitarias activas de la tienda (o solo `onlyAccounts`).
 * Cada cuenta guarda su propio estado; la tienda queda «sincronizada» si al menos una funcionó.
 */
export async function syncMetaStore(
  admin: SupabaseClient,
  storeId: string,
  days = DAILY_SYNC_DAYS,
  f: typeof fetch = fetch,
  onlyAccounts?: string[],
): Promise<SyncResult> {
  const until = limaToday();
  const since = addDays(until, -(days - 1));

  const [{ data: meta }, { data: settings }, { data: accountRows }] = await Promise.all([
    admin.from("store_meta_settings").select("capi_token_encrypted, ad_account_id, ad_account_name, ad_account_currency").eq("store_id", storeId).maybeSingle(),
    admin.from("store_settings").select("usd_rate, apply_igv").eq("store_id", storeId).maybeSingle(),
    admin.from("store_meta_accounts").select("ad_account_id, name, currency").eq("store_id", storeId).eq("enabled", true),
  ]);
  if (!meta?.capi_token_encrypted) return { ok: false, error: "Meta no está conectado" };

  // Compatibilidad: una tienda conectada antes de «varias cuentas» solo tiene su cuenta principal
  let accounts: Account[] = (accountRows ?? []) as Account[];
  if (!accounts.length && meta.ad_account_id) accounts = [{ ad_account_id: meta.ad_account_id, name: meta.ad_account_name, currency: meta.ad_account_currency }];
  if (onlyAccounts) accounts = accounts.filter((a) => onlyAccounts.includes(a.ad_account_id));
  if (!accounts.length) return { ok: false, error: "Meta no está conectado" };

  const fail = async (error: string) => {
    await admin.from("store_meta_settings").update({ last_sync_error: error.slice(0, 1000) }).eq("store_id", storeId);
    return { ok: false as const, error };
  };

  let token: string;
  try {
    token = decryptSecret(meta.capi_token_encrypted);
  } catch {
    return fail("No se pudo descifrar el token de Meta");
  }

  let rows = 0;
  let spend = 0;
  const failed: { account: string; error: string }[] = [];
  for (const account of accounts) {
    const r = await syncAccount(admin, storeId, token, account, since, until, settings, f);
    const now = new Date().toISOString();
    if (r.ok) {
      rows += r.rows;
      spend += r.spend;
      await admin.from("store_meta_accounts").update({ last_sync_at: now, last_sync_error: null }).eq("store_id", storeId).eq("ad_account_id", account.ad_account_id);
    } else {
      failed.push({ account: account.name ?? account.ad_account_id, error: r.error });
      await admin
        .from("store_meta_accounts")
        .update({ last_sync_error: r.error.slice(0, 1000) })
        .eq("store_id", storeId)
        .eq("ad_account_id", account.ad_account_id);
    }
  }

  if (failed.length === accounts.length) return fail(failed.map((x) => `${x.account}: ${x.error}`).join(" · "));
  await admin
    .from("store_meta_settings")
    .update({ last_sync_at: new Date().toISOString(), last_sync_error: failed.length ? failed.map((x) => `${x.account}: ${x.error}`).join(" · ").slice(0, 1000) : null })
    .eq("store_id", storeId);
  return { ok: true, rows, spend: Math.round(spend * 100) / 100, since, until, accounts: accounts.length, failed };
}

/**
 * Lee la tienda si ya le toca según su intervalo. Primero «marca» la lectura con una actualización
 * condicional, así dos pestañas o el reloj y una pestaña no leen la misma tienda a la vez.
 */
export async function syncMetaIfStale(admin: SupabaseClient, storeId: string): Promise<boolean> {
  const { data: row, error } = await admin.from("store_meta_settings").select("sync_every_minutes").eq("store_id", storeId).maybeSingle();
  // Sin la columna (falta el SQL) se usa el valor por defecto
  const every = error ? DEFAULT_SYNC_MINUTES : parseSyncInterval(row?.sync_every_minutes);
  const cutoff = new Date(Date.now() - (every - TOLERANCE_MINUTES) * 60_000).toISOString();
  const { data } = await admin
    .from("store_meta_settings")
    .update({ last_sync_at: new Date().toISOString() })
    .eq("store_id", storeId)
    .eq("sync_enabled", true)
    .not("ad_account_id", "is", null)
    .or(`last_sync_at.is.null,last_sync_at.lt.${cutoff}`)
    .select("store_id");
  if (!data?.length) return false;
  await syncMetaStore(admin, storeId, SCHEDULED_SYNC_DAYS);
  return true;
}

/**
 * Reloj horario (Supabase pg_cron → /api/cron/meta-sync): lee las tiendas a las que ya les toca,
 * las más atrasadas primero, sin pasarse del tiempo máximo de la función (las demás, en la próxima hora).
 */
export async function syncDueMetaStores(admin: SupabaseClient, budgetMs = 45_000) {
  const started = Date.now();
  const { data } = await admin
    .from("store_meta_settings")
    .select("store_id, sync_every_minutes, last_sync_at")
    .not("ad_account_id", "is", null)
    .eq("sync_enabled", true)
    .order("last_sync_at", { ascending: true, nullsFirst: true });
  const due = (data ?? []).filter((s) => isSyncDue(s.last_sync_at, parseSyncInterval(s.sync_every_minutes)));
  const done: string[] = [];
  for (const s of due) {
    if (Date.now() - started > budgetMs) break;
    if (await syncMetaIfStale(admin, s.store_id)) done.push(s.store_id);
  }
  return { due: due.length, synced: done.length };
}

/** Sincroniza todas las tiendas conectadas (cron diario). */
export async function syncAllMetaStores(admin: SupabaseClient) {
  const { data } = await admin.from("store_meta_settings").select("store_id").not("ad_account_id", "is", null).eq("sync_enabled", true);
  const results: { storeId: string; ok: boolean; error?: string }[] = [];
  for (const s of data ?? []) {
    const r = await syncMetaStore(admin, s.store_id);
    results.push({ storeId: s.store_id, ok: r.ok, ...(r.ok ? {} : { error: r.error }) });
  }
  return results;
}

/**
 * Para las páginas que muestran gasto (Inicio, Rendimiento, Gastos): después de responder,
 * si la última lectura de Meta tiene más de una hora, se vuelve a leer en segundo plano.
 * No frena la página: el dato nuevo aparece en la siguiente visita.
 */
export function refreshMetaInBackground(storeId: string) {
  after(async () => {
    try {
      await syncMetaIfStale(createAdminClient(), storeId);
    } catch (e) {
      console.error("Lectura automática de Meta", e);
    }
  });
}
