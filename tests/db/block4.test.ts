/**
 * Bloque 4 — Meta y Rendimiento: sincronización (con Meta simulado), gasto en soles,
 * reemplazo del CSV, rendimiento por nivel y permisos. Ejecutar: npm run test:db
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { encryptSecret } from "@/lib/crypto";
import { createClassicTemplate } from "@/modules/landing/defaults";
import { limaToday } from "@/modules/metrics/date-range";
import { syncMetaStore } from "@/modules/meta/sync";

config({ path: ".env.local", quiet: true });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const admin = createClient(url, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
const runId = `${Date.now().toString(36)}b4`;
const today = limaToday();

type User = { id: string; email: string; client: SupabaseClient };
async function createUser(label: string): Promise<User> {
  const email = `vendia-test-${label}-${runId}@example.com`;
  const password = `Test-${runId}-${label}-Pass!`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const client = createClient(url, publishable, { auth: { persistSession: false, autoRefreshToken: false } });
  await client.auth.signInWithPassword({ email, password });
  return { id: data.user.id, email, client };
}

let owner: User;
let staff: User;
let storeId: string;

/** Meta simulado: 2 anuncios de una campaña hoy, en dólares. */
const fakeMeta = (async (input: RequestInfo | URL) => {
  const u = String(input);
  if (u.includes("/insights")) {
    return Response.json({
      data: [
        { date_start: today, campaign_id: "90001", campaign_name: "Fajas BF", adset_id: "90002", adset_name: "Mujeres", ad_id: "90003", ad_name: "Video A", spend: "10", impressions: "2000", reach: "1500", inline_link_clicks: "50", actions: [{ action_type: "lead", value: "4" }] },
        { date_start: today, campaign_id: "90001", campaign_name: "Fajas BF", adset_id: "90002", adset_name: "Mujeres", ad_id: "90004", ad_name: "Imagen B", spend: "5", impressions: "1000", reach: "900", inline_link_clicks: "20" },
      ],
    });
  }
  if (u.includes("ids=")) {
    return Response.json({ "90003": { id: "90003", effective_status: "ACTIVE", preview_shareable_link: "https://fb.me/p", creative: { thumbnail_url: "https://img/a.jpg", body: "Texto A" } } });
  }
  return Response.json({ error: { message: "no simulado", code: 100 } }, { status: 400 });
}) as typeof fetch;

beforeAll(async () => {
  owner = await createUser("owner");
  staff = await createUser("staff");
  const { data: sid, error } = await owner.client.rpc("create_store", { p_name: "Tienda B4", p_slug: `b4-${runId}` });
  if (error) throw error;
  storeId = sid as string;
  const { data: token } = await owner.client.rpc("create_store_invitation", { p_store_id: storeId, p_email: staff.email });
  await staff.client.rpc("accept_store_invitation", { p_token: token });
  await admin.from("store_settings").update({ usd_rate: 3.8, apply_igv: true }).eq("store_id", storeId);
  await admin.from("store_meta_settings").insert({
    store_id: storeId,
    pixel_id: "123456789012345",
    capi_token_encrypted: encryptSecret("T".repeat(60)),
    enabled: true,
    ad_account_id: "act_123456",
    ad_account_name: "Cuenta USD",
    ad_account_currency: "USD",
  });
  // Producto y landing para un pedido atribuido al anuncio 9003
  const { data: p } = await owner.client.from("products").insert({ store_id: storeId, name: "Faja", price: 100, cost: 30, status: "active" }).select("id").single();
  const { data: o } = await owner.client.from("product_offers").insert({ store_id: storeId, product_id: p!.id, name: "1 u", quantity: 1, price: 100, is_default: true }).select("id").single();
  const { data: l } = await owner.client.from("landing_pages").insert({ store_id: storeId, product_id: p!.id, title: "Faja", slug: "faja", content: createClassicTemplate() }).select("id").single();
  await owner.client.rpc("publish_landing_page", { p_landing_id: l!.id });
  await admin.rpc("create_cod_order", {
    p: {
      landing_page_id: l!.id,
      offer_id: o!.id,
      idempotency_key: `k-${runId}`,
      first_name: "Ana",
      phone: "51900000401",
      district_code: "150101",
      address: "Av. 1",
      attribution: { campaign_id: "90001", adset_id: "90002", ad_id: "90003" },
    },
  });
  // Gasto importado por CSV del mismo día y campaña (debe reemplazarse)
  await admin.from("expenses").insert({ store_id: storeId, expense_date: today, category: "meta_ads", amount: 99, source: "import", import_key: `csv-${runId}`, campaign_id: "90001" });
});

afterAll(async () => {
  if (storeId) await admin.from("stores").delete().eq("id", storeId);
  for (const u of [owner, staff]) if (u) await admin.auth.admin.deleteUser(u.id);
});

describe("Sincronización con Meta", () => {
  it("guarda campañas, anuncios con su creatividad y métricas con el gasto en soles", async () => {
    const r = await syncMetaStore(admin, storeId, 3, fakeMeta);
    expect(r, JSON.stringify(r)).toMatchObject({ ok: true, rows: 2 });
    const { data: ents } = await owner.client.from("meta_entities").select("id, level, name, thumbnail_url").eq("store_id", storeId).order("id");
    expect(ents?.map((e) => e.level)).toEqual(["campaign", "adset", "ad", "ad"]);
    expect(ents?.find((e) => e.id === "90003")?.thumbnail_url).toBe("https://img/a.jpg");
    const { data: ins } = await owner.client.from("meta_insights_daily").select("ad_id, spend_pen").eq("store_id", storeId).order("ad_id");
    expect(ins?.map((i) => Number(i.spend_pen))).toEqual([44.84, 22.42]); // 10 USD × 3.8 × 1.18 · 5 USD × 3.8 × 1.18
  });

  it("el gasto queda en Gastos por campaña y día, reemplazando al CSV de ese día", async () => {
    const { data: exp } = await owner.client.from("expenses").select("source, amount, currency, amount_pen").eq("store_id", storeId).eq("expense_date", today);
    expect(exp).toHaveLength(1);
    expect(exp?.[0]).toMatchObject({ source: "meta_sync", currency: "USD" });
    expect(Number(exp?.[0].amount_pen)).toBe(67.26);
    // Volver a sincronizar no duplica
    await syncMetaStore(admin, storeId, 3, fakeMeta);
    expect((await owner.client.from("expenses").select("id").eq("store_id", storeId)).data).toHaveLength(1);
  });

  it("Rendimiento por anuncio: costo por resultado de Meta junto al pedido real", async () => {
    const from = new Date(Date.now() - 86400_000).toISOString();
    const to = new Date(Date.now() + 86400_000).toISOString();
    const { data } = await owner.client.rpc("get_performance", { p_store_id: storeId, p_from: from, p_to: to, p_from_date: today, p_to_date: today, p_level: "ad" });
    const a = (data as { key: string; name: string; results: number; orders: number; ad_spend: number; campaign_name: string }[]).find((x) => x.key === "90003");
    expect(a).toMatchObject({ name: "Video A", results: 4, orders: 1, campaign_name: "Fajas BF" });
    expect(Number(a?.ad_spend)).toBe(44.84);
  });

  it("el confirmador ve la tarjeta del anuncio pero no el gasto ni el rendimiento", async () => {
    expect((await staff.client.from("meta_entities").select("id").eq("store_id", storeId)).data?.length).toBe(4);
    expect((await staff.client.from("meta_insights_daily").select("ad_id").eq("store_id", storeId)).data).toEqual([]);
    expect((await staff.client.rpc("get_performance", { p_store_id: storeId, p_from: today, p_to: today, p_from_date: today, p_to_date: today, p_level: "ad" })).error).not.toBeNull();
    // El token nunca es legible desde el cliente
    expect((await owner.client.from("store_meta_settings").select("capi_token_encrypted").eq("store_id", storeId)).error).not.toBeNull();
  });

  it("si Meta falla, guarda el error para mostrarlo", async () => {
    const broken = (async () => Response.json({ error: { message: "Invalid OAuth", code: 190 } }, { status: 400 })) as typeof fetch;
    const r = await syncMetaStore(admin, storeId, 3, broken);
    expect(r.ok).toBe(false);
    const { data } = await owner.client.from("store_meta_settings").select("last_sync_error").eq("store_id", storeId).single();
    expect(data?.last_sync_error).toMatch(/token/);
  });
});
