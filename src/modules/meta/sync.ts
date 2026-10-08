import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptSecret } from "@/lib/crypto";
import { IGV_RATE, toPen } from "@/modules/expenses/categories";
import { addDays, limaToday } from "@/modules/metrics/date-range";
import { fetchAdCreatives, fetchInsights, type InsightRow, MetaApiError } from "./marketing-api";

export type SyncResult = { ok: true; rows: number; spend: number; since: string; until: string } | { ok: false; error: string };

/** Días que se vuelven a pedir: Meta ajusta las cifras de los últimos días. */
export const DAILY_SYNC_DAYS = 3;
export const FIRST_SYNC_DAYS = 30;

/**
 * Trae de Meta las métricas por anuncio y por día, y:
 *  1. guarda campañas, conjuntos y anuncios (con su creatividad),
 *  2. guarda las métricas diarias con el gasto en soles,
 *  3. registra el gasto como «Meta Ads» por campaña y día (reemplaza al CSV en esos días),
 *     así el CPA real, el ROAS y la utilidad lo usan sin cambios.
 */
export async function syncMetaStore(admin: SupabaseClient, storeId: string, days = DAILY_SYNC_DAYS, f: typeof fetch = fetch): Promise<SyncResult> {
  const until = limaToday();
  const since = addDays(until, -(days - 1));

  const [{ data: meta }, { data: settings }] = await Promise.all([
    admin.from("store_meta_settings").select("capi_token_encrypted, ad_account_id, ad_account_currency").eq("store_id", storeId).maybeSingle(),
    admin.from("store_settings").select("usd_rate, apply_igv").eq("store_id", storeId).maybeSingle(),
  ]);
  if (!meta?.ad_account_id || !meta.capi_token_encrypted) return { ok: false, error: "Meta no está conectado" };

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

  const usd = meta.ad_account_currency === "USD";
  const rate = usd ? Number(settings?.usd_rate ?? 1) : 1;
  const igv = settings?.apply_igv ? IGV_RATE : 0;

  let rows: InsightRow[];
  try {
    rows = await fetchInsights(token, meta.ad_account_id, since, until, f);
  } catch (e) {
    return fail(e instanceof MetaApiError ? e.message : "No se pudo leer las métricas de Meta");
  }

  // 1. Campañas, conjuntos y anuncios
  const entities = new Map<string, Record<string, unknown>>();
  const now = new Date().toISOString();
  for (const r of rows) {
    entities.set(r.campaignId, { store_id: storeId, id: r.campaignId, level: "campaign", name: r.campaignName, updated_at: now });
    entities.set(r.adsetId, { store_id: storeId, id: r.adsetId, level: "adset", name: r.adsetName, campaign_id: r.campaignId, updated_at: now });
    entities.set(r.adId, { store_id: storeId, id: r.adId, level: "ad", name: r.adName, campaign_id: r.campaignId, adset_id: r.adsetId, updated_at: now });
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
    if (error) return fail("No se pudieron guardar las campañas");
  }

  // 2. Métricas diarias (se reemplaza el rango completo: si un anuncio quedó en 0, desaparece)
  await admin.from("meta_insights_daily").delete().eq("store_id", storeId).gte("date", since).lte("date", until);
  if (rows.length) {
    const { error } = await admin.from("meta_insights_daily").insert(
      rows.map((r) => ({
        store_id: storeId,
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
    if (error) return fail("No se pudieron guardar las métricas");
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
  // Producto de cada campaña: el último que el vendedor le asignó a mano o al importar
  const { data: mapped } = campaignIds.length
    ? await admin.from("expenses").select("campaign_id, product_id").eq("store_id", storeId).in("campaign_id", campaignIds).not("product_id", "is", null).order("created_at", { ascending: false })
    : { data: [] as { campaign_id: string; product_id: string }[] };
  const productOf = new Map<string, string>();
  for (const m of mapped ?? []) if (!productOf.has(m.campaign_id)) productOf.set(m.campaign_id, m.product_id);

  await admin.from("expenses").delete().eq("store_id", storeId).eq("source", "meta_sync").gte("expense_date", since).lte("expense_date", until);
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
    if (error) return fail("No se pudo registrar el gasto de Meta");
  }

  await admin.from("store_meta_settings").update({ last_sync_at: now, last_sync_error: null }).eq("store_id", storeId);
  const spend = Math.round(rows.reduce((s, r) => s + toPen(r.spend, rate, igv), 0) * 100) / 100;
  return { ok: true, rows: rows.length, spend, since, until };
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
