/**
 * Bloque 3 — Números correctos: venta real por zona, gasto en soles (USD + IGV), costo logístico, % atribuido.
 * Ejecutar: npm run test:db
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClassicTemplate } from "@/modules/landing/defaults";

config({ path: ".env.local", quiet: true });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const admin = createClient(url, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
const runId = `${Date.now().toString(36)}b3`;

let owner: { id: string; client: SupabaseClient };
let storeId: string;
let landingId: string;
let offerId: string;
const from = new Date(Date.now() - 86400_000).toISOString();
const to = new Date(Date.now() + 86400_000).toISOString();
const today = new Date().toISOString().slice(0, 10);

const newOrder = async (phone: string, district: string, campaign?: string) => {
  const { data, error } = await admin.rpc("create_cod_order", {
    p: {
      landing_page_id: landingId,
      offer_id: offerId,
      idempotency_key: `k-${phone}-${runId}`,
      first_name: "Cliente",
      phone,
      district_code: district,
      address: "Av. Prueba 1",
      dni: "12345678",
      ...(campaign ? { attribution: { campaign_id: campaign, utm_campaign: "Prueba" } } : {}),
    },
  });
  if (error) throw error;
  return (data as { order_id: string }).order_id;
};
const move = async (id: string, ...steps: string[]) => {
  for (const s of steps) {
    const { error } = await owner.client.rpc("change_order_status", { p_order_id: id, p_to: s, ...(s === "failed_delivery" ? { p_reason: "no_estaba" } : {}) });
    if (error) throw error;
  }
};
const stats = async () => (await owner.client.rpc("get_order_stats", { p_store_id: storeId, p_from: from, p_to: to })).data;

beforeAll(async () => {
  const email = `vendia-test-owner-${runId}@example.com`;
  const password = `Test-${runId}-Pass!`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const client = createClient(url, publishable, { auth: { persistSession: false, autoRefreshToken: false } });
  await client.auth.signInWithPassword({ email, password });
  owner = { id: data.user.id, client };
  const { data: sid } = await client.rpc("create_store", { p_name: "Tienda B3", p_slug: `b3-${runId}` });
  storeId = sid as string;
  const { data: p } = await client.from("products").insert({ store_id: storeId, name: "Faja", price: 100, cost: 30, status: "active" }).select("id").single();
  const { data: o } = await client
    .from("product_offers")
    .insert({ store_id: storeId, product_id: p!.id, name: "1 u", quantity: 1, price: 100, is_default: true })
    .select("id")
    .single();
  offerId = o!.id;
  const { data: l } = await client
    .from("landing_pages")
    .insert({ store_id: storeId, product_id: p!.id, title: "Faja", slug: "faja", content: createClassicTemplate() })
    .select("id")
    .single();
  landingId = l!.id;
  await client.rpc("publish_landing_page", { p_landing_id: landingId });
});

afterAll(async () => {
  if (storeId) await admin.from("stores").delete().eq("id", storeId);
  if (owner) await admin.auth.admin.deleteUser(owner.id);
});

describe("Venta real por zona", () => {
  it("Lima cuenta al entregar y provincia al cobrar; con «Entregado» provincia espera a que recoja", async () => {
    const lima = await newOrder("51900000301", "150101", "120200");
    const prov = await newOrder("51900000302", "040101");
    await move(lima, "confirmed", "shipped", "delivered");
    await move(prov, "confirmed", "shipped", "at_agency", "collected");

    let s = await stats();
    expect(s).toMatchObject({ sale_mode: "zone", delivered: 2, orders: 2, attributed: 1 });
    expect(Number(s.revenue)).toBe(200);
    expect(Number(s.in_progress)).toBe(0);

    await owner.client.from("store_settings").update({ real_sale_mode: "delivered" }).eq("store_id", storeId);
    s = await stats();
    expect(s.delivered).toBe(1);
    expect(s.in_progress).toBe(1);
    await owner.client.from("store_settings").update({ real_sale_mode: "zone" }).eq("store_id", storeId);
  });

  it("costo logístico: no entregado con 2 envíos de Shalom", async () => {
    const before = Number((await stats()).shipping_cost);
    const prov = await newOrder("51900000303", "080101");
    await move(prov, "confirmed", "shipped", "failed_delivery");
    const { data } = await owner.client.from("orders").select("shipping_cost, return_shipments").eq("id", prov).single();
    expect(data?.return_shipments).toBe(2);
    expect(Number((await stats()).shipping_cost)).toBe(before + Number(data?.shipping_cost) * 2);
  });
});

describe("Gasto en soles", () => {
  it("USD × tipo de cambio + IGV, y lo usan totales y campañas", async () => {
    const { data, error } = await owner.client
      .from("expenses")
      .insert({ store_id: storeId, expense_date: today, category: "meta_ads", amount: 50, currency: "USD", exchange_rate: 3.8, igv_rate: 0.18, campaign_id: "120200" })
      .select("amount_pen")
      .single();
    expect(error).toBeNull();
    expect(Number(data?.amount_pen)).toBe(224.2);
    const { data: totals } = await owner.client.rpc("get_expense_totals", { p_store_id: storeId, p_from: today, p_to: today });
    expect(Number(totals.ad_spend)).toBe(224.2);
    expect(Number(totals.igv)).toBe(34.2);
    const { data: camps } = await owner.client.rpc("get_campaign_stats", { p_store_id: storeId, p_from: from, p_to: to, p_from_date: today, p_to_date: today });
    const c = (camps as { campaign_key: string; ad_spend: number; delivered: number }[]).find((x) => x.campaign_key === "120200");
    expect(Number(c?.ad_spend)).toBe(224.2);
    expect(c?.delivered).toBe(1);
  });
});
