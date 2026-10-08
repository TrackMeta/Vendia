/**
 * Tests de integración de Gastos, Meta (Pixel/CAPI), Analítica, Logística/Webhooks y Admin.
 * Ejecutar: npm run test:db  (requiere aplicar supabase/actualizacion-fases-2-5.sql)
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { encryptSecret } from "@/lib/crypto";
import { createClassicTemplate } from "@/modules/landing/defaults";
import { enqueueOrderEvent, maybeSendPurchase } from "@/modules/meta/capi";

config({ path: ".env.local", quiet: true });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const admin = createClient(url, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
const anon = createClient(url, publishable, { auth: { persistSession: false, autoRefreshToken: false } });
const runId = `${Date.now().toString(36)}p`;

type Tenant = { userId: string; client: SupabaseClient; storeId: string; slug: string };

async function createTenant(label: string): Promise<Tenant> {
  const email = `vendia-test-${label}-${runId}@example.com`;
  const password = `Test-${runId}-${label}-Pass!`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const client = createClient(url, publishable, { auth: { persistSession: false, autoRefreshToken: false } });
  await client.auth.signInWithPassword({ email, password });
  const slug = `test-${label}-${runId}`;
  const { data: storeId, error: e2 } = await client.rpc("create_store", { p_name: `Tienda ${label}`, p_slug: slug });
  if (e2) throw e2;
  return { userId: data.user.id, client, storeId: storeId as string, slug };
}

let a: Tenant;
let b: Tenant;
let productId: string;
let offerId: string;
let landingId: string;
let orderId: string;

const today = new Date(Date.now() - 5 * 3600_000).toISOString().slice(0, 10);

beforeAll(async () => {
  a = await createTenant("pa");
  b = await createTenant("pb");
  const { data: product } = await a.client.from("products").insert({ store_id: a.storeId, name: "Faja", price: 79.9, cost: 25, status: "active" }).select("id").single();
  productId = product!.id;
  const { data: offer } = await a.client
    .from("product_offers")
    .insert({ store_id: a.storeId, product_id: productId, name: "1 unidad", quantity: 1, price: 79.9, is_default: true })
    .select("id")
    .single();
  offerId = offer!.id;
  const { data: landing } = await a.client
    .from("landing_pages")
    .insert({ store_id: a.storeId, product_id: productId, title: "Faja", slug: "faja", content: createClassicTemplate() })
    .select("id")
    .single();
  landingId = landing!.id;
  await a.client.rpc("publish_landing_page", { p_landing_id: landingId });

  const { data: order } = await admin.rpc("create_cod_order", {
    p: {
      landing_page_id: landingId,
      offer_id: offerId,
      idempotency_key: `k-${runId}`,
      first_name: "Ana",
      last_name: "Rojas",
      phone: "51987650000",
      district_code: "150133",
      address: "Av. Prueba 1",
      reference: "Parque",
      attribution: { utm_source: "facebook", utm_campaign: "Campaña Test", campaign_id: `cmp-${runId}`, fbc: "fb.1.1.abc", fbp: "fb.1.1.123" },
      client_ip: "190.1.2.3",
      user_agent: "vitest",
    },
  });
  orderId = order.order_id;

});

afterAll(async () => {
  vi.unstubAllGlobals();
  for (const t of [a, b]) {
    if (!t) continue;
    await admin.from("stores").delete().eq("id", t.storeId);
    await admin.auth.admin.deleteUser(t.userId);
  }
});

describe("Gastos", () => {
  it("registra gastos y calcula totales sin doble conteo", async () => {
    await a.client.from("expenses").insert([
      { store_id: a.storeId, expense_date: today, category: "meta_ads", amount: 100, campaign_id: `cmp-${runId}`, product_id: productId },
      { store_id: a.storeId, expense_date: today, category: "software", amount: 30 },
      { store_id: a.storeId, expense_date: today, category: "product", amount: 500 },
    ]);
    const { data, error } = await a.client.rpc("get_expense_totals", { p_store_id: a.storeId, p_from: today, p_to: today });
    expect(error).toBeNull();
    expect(Number(data.ad_spend)).toBe(100);
    expect(Number(data.other_expenses)).toBe(30);
    expect(Number(data.reference_only)).toBe(500);
  });

  it("otra tienda no ve ni suma mis gastos", async () => {
    const { data } = await b.client.from("expenses").select("id").eq("store_id", a.storeId);
    expect(data).toEqual([]);
    const { error } = await b.client.rpc("get_expense_totals", { p_store_id: a.storeId, p_from: today, p_to: today });
    expect(error).not.toBeNull();
  });

  it("reimportar el mismo reporte (import_key) no duplica", async () => {
    const row = { store_id: a.storeId, expense_date: today, category: "meta_ads", amount: 10, source: "import", import_key: `meta:${today}:x-${runId}` };
    await a.client.from("expenses").upsert(row, { onConflict: "store_id,import_key" });
    await a.client.from("expenses").upsert({ ...row, amount: 12 }, { onConflict: "store_id,import_key" });
    const { data } = await a.client.from("expenses").select("amount").eq("import_key", row.import_key);
    expect(data).toHaveLength(1);
    expect(Number(data![0].amount)).toBe(12);
  });
});

describe("Meta: configuración y seguridad del token", () => {
  it("el vendedor puede guardar el token pero NO leerlo", async () => {
    const { error } = await a.client
      .from("store_meta_settings")
      .insert({ store_id: a.storeId, pixel_id: "123456789012345", capi_token_encrypted: encryptSecret("EAAG-token-de-prueba"), enabled: true });
    expect(error).toBeNull();
    const read = await a.client.from("store_meta_settings").select("capi_token_encrypted").eq("store_id", a.storeId);
    expect(read.error).not.toBeNull();
    const { data: configured } = await a.client.rpc("meta_token_configured", { p_store_id: a.storeId });
    expect(configured).toBe(true);
  });

  it("la landing pública expone solo el Pixel ID (nunca el token)", async () => {
    const { data } = await anon.rpc("get_public_landing", { p_store_slug: a.slug, p_slug: "faja" });
    expect(data.meta.pixel_id).toBe("123456789012345");
    expect(JSON.stringify(data)).not.toContain("EAAG");
  });

  it("otra tienda no puede leer ni cambiar mi configuración de Meta", async () => {
    const { data } = await b.client.from("store_meta_settings").select("pixel_id").eq("store_id", a.storeId);
    expect(data).toEqual([]);
  });
});

describe("Meta Conversions API (respuesta de Meta simulada)", () => {
  it("envía Lead una sola vez y Purchase solo al entregar, con el mismo event_id estable", async () => {
    const calls: { url: string; body: { data: { event_name: string; event_id: string; custom_data: { value: number; currency: string }; user_data: Record<string, unknown> }[] } }[] = [];
    // Solo se simula Meta (graph.facebook.com); Supabase usa el fetch real.
    const realFetch = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).startsWith("https://graph.facebook.com/")) {
          calls.push({ url: String(input), body: JSON.parse(String(init?.body)) });
          return new Response(JSON.stringify({ events_received: 1, fbtrace_id: "x" }), { status: 200 });
        }
        return realFetch(input, init);
      }),
    );

    expect(await enqueueOrderEvent(admin, orderId, "Lead")).not.toBeNull();
    expect(await enqueueOrderEvent(admin, orderId, "Lead")).toBeNull(); // deduplicado en la BD

    expect(await maybeSendPurchase(admin, orderId)).toBeNull(); // aún no entregado
    await a.client.rpc("change_order_status", { p_order_id: orderId, p_to: "delivered" });
    expect(await maybeSendPurchase(admin, orderId)).not.toBeNull();
    expect(await maybeSendPurchase(admin, orderId)).toBeNull(); // nunca dos Purchase

    expect(calls).toHaveLength(2);
    expect(calls[0].url).toContain("/v26.0/123456789012345/events");
    vi.unstubAllGlobals();
    const [lead, purchase] = calls.map((c) => c.body.data[0]);
    expect(lead.event_name).toBe("Lead");
    expect(lead.event_id).toBe(`lead_${orderId}`);
    expect(purchase.event_name).toBe("Purchase");
    expect(purchase.event_id).toBe(`purchase_${orderId}`);
    expect(purchase.custom_data).toMatchObject({ value: 79.9, currency: "PEN" });
    expect(purchase.user_data.fbc).toBe("fb.1.1.abc");
    expect(String((purchase.user_data.ph as string[])[0])).toMatch(/^[a-f0-9]{64}$/);

    const { data: events } = await a.client.from("marketing_events").select("event_name, status").eq("order_id", orderId);
    expect(events?.map((e) => e.status)).toEqual(["sent", "sent"]);
  });
});

describe("Analítica", () => {
  it("solo el servidor registra visitas; las repetidas de la misma sesión no se duplican", async () => {
    expect((await anon.rpc("track_landing_event", { p_landing_id: landingId, p_event: "page_view", p_session: "anon-session-1" })).error).not.toBeNull();
    for (let i = 0; i < 2; i++) await admin.rpc("track_landing_event", { p_landing_id: landingId, p_event: "page_view", p_session: `ses-${runId}` });
    await admin.rpc("track_landing_event", { p_landing_id: landingId, p_event: "initiate_checkout", p_session: `ses-${runId}` });
    const from = new Date(Date.now() - 3600_000).toISOString();
    const to = new Date(Date.now() + 3600_000).toISOString();
    const { data } = await a.client.rpc("get_funnel", { p_store_id: a.storeId, p_from: from, p_to: to });
    expect(data.visits).toBe(1);
    expect(data.initiate_checkout).toBe(1);
    expect(data.orders).toBe(1);
    expect(data.delivered).toBe(1);
  });

  it("une pedidos y gasto por campaign_id", async () => {
    const from = new Date(Date.now() - 3600_000).toISOString();
    const to = new Date(Date.now() + 3600_000).toISOString();
    const { data } = await a.client.rpc("get_campaign_stats", { p_store_id: a.storeId, p_from: from, p_to: to, p_from_date: today, p_to_date: today });
    const row = (data as Record<string, unknown>[]).find((r) => r.campaign_id === `cmp-${runId}`)!;
    expect(row.orders).toBe(1);
    expect(row.delivered).toBe(1);
    expect(Number(row.ad_spend)).toBe(100);
    expect(Number(row.revenue)).toBe(79.9);
  });

  it("estadísticas por producto y por ubicación", async () => {
    const from = new Date(Date.now() - 3600_000).toISOString();
    const to = new Date(Date.now() + 3600_000).toISOString();
    const { data: products } = await a.client.rpc("get_product_stats", { p_store_id: a.storeId, p_from: from, p_to: to, p_from_date: today, p_to_date: today });
    expect((products as Record<string, unknown>[])[0]).toMatchObject({ name: "Faja", orders: 1, visits: 1 });
    const { data: geo } = await a.client.rpc("get_geo_stats", { p_store_id: a.storeId, p_from: from, p_to: to, p_level: "district", p_parent: "1501" });
    expect((geo as Record<string, unknown>[])[0]).toMatchObject({ code: "150133", name: "San Juan de Miraflores", delivered: 1 });
    const other = await b.client.rpc("get_geo_stats", { p_store_id: a.storeId, p_from: from, p_to: to, p_level: "department" });
    expect(other.error).not.toBeNull();
  });
});

describe("Logística e integraciones", () => {
  it("apply_integration_status solo lo usa el servidor y es idempotente", async () => {
    const { data: o2 } = await admin.rpc("create_cod_order", {
      p: { landing_page_id: landingId, offer_id: offerId, idempotency_key: `k2-${runId}`, first_name: "Luis", phone: "51987650001", district_code: "040101", address: "Calle 2" },
    });
    expect((await a.client.rpc("apply_integration_status", { p_store_id: a.storeId, p_order_number: o2.order_number, p_external_order_id: null, p_to: "shipped", p_note: null })).error).not.toBeNull();

    const first = await admin.rpc("apply_integration_status", { p_store_id: a.storeId, p_order_number: o2.order_number, p_external_order_id: null, p_to: "shipped", p_note: "courier", p_tracking_code: "TRK-1" });
    expect(first.data.changed).toBe(true);
    const again = await admin.rpc("apply_integration_status", { p_store_id: a.storeId, p_order_number: o2.order_number, p_external_order_id: null, p_to: "shipped", p_note: "courier" });
    expect(again.data.changed).toBe(false);

    const { data: order } = await a.client.from("orders").select("status, tracking_code").eq("id", o2.order_id).single();
    expect(order).toMatchObject({ status: "shipped", tracking_code: "TRK-1" });
    const { data: history } = await a.client.from("order_status_history").select("source").eq("order_id", o2.order_id).order("id");
    expect(history?.at(-1)?.source).toBe("integration");
  });

  it("cambio de estado en lote respeta las reglas y la tienda", async () => {
    const { data: o3 } = await admin.rpc("create_cod_order", {
      p: { landing_page_id: landingId, offer_id: offerId, idempotency_key: `k3-${runId}`, first_name: "Eva", phone: "51987650002", district_code: "150133", address: "Calle 3" },
    });
    const { data } = await a.client.rpc("change_orders_status", { p_order_ids: [o3.order_id, orderId], p_to: "confirmed" });
    expect(data).toEqual({ updated: 1, failed: 1 }); // el ya entregado no puede volver a confirmado
    const intruder = await b.client.rpc("change_orders_status", { p_order_ids: [o3.order_id], p_to: "cancelled" });
    expect(intruder.data).toEqual({ updated: 0, failed: 1 });
  });

  it("los secretos de integraciones no son legibles por el vendedor", async () => {
    await admin.from("integrations").upsert({ store_id: a.storeId, provider: "generic_webhook", webhook_secret_encrypted: encryptSecret("whsec_x") }, { onConflict: "store_id,provider" });
    const read = await a.client.from("integrations").select("webhook_secret_encrypted").eq("store_id", a.storeId);
    expect(read.error).not.toBeNull();
    const ok = await a.client.from("integrations").select("provider, status").eq("store_id", a.storeId);
    expect(ok.data?.[0]).toMatchObject({ provider: "generic_webhook", status: "active" });
  });
});

describe("Admin", () => {
  it("un vendedor no puede usar las funciones de administración", async () => {
    expect((await a.client.rpc("admin_overview")).error).not.toBeNull();
    expect((await a.client.rpc("admin_set_store_status", { p_store_id: b.storeId, p_status: "blocked" })).error).not.toBeNull();
    expect((await anon.rpc("admin_list_users")).error).not.toBeNull();
  });

  it("un administrador ve la plataforma y puede bloquear una tienda", async () => {
    await admin.from("platform_admins").insert({ user_id: a.userId });
    const { data, error } = await a.client.rpc("admin_overview");
    expect(error).toBeNull();
    expect(data.stores).toBeGreaterThanOrEqual(2);
    expect((await a.client.rpc("admin_set_store_status", { p_store_id: b.storeId, p_status: "blocked" })).error).toBeNull();
    const { data: store } = await admin.from("stores").select("status").eq("id", b.storeId).single();
    expect(store?.status).toBe("blocked");
    await admin.from("platform_admins").delete().eq("user_id", a.userId);
  });
});

