/**
 * Bloque 5 — Landing y ventas: order bumps (precio del servidor), upsell en gracias,
 * formularios abandonados, A/B y ángulos, correo. Ejecutar: npm run test:db
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTemplate } from "@/modules/landing/defaults";
import { landingContent } from "@/modules/landing/schema";

config({ path: ".env.local", quiet: true });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const admin = createClient(url, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
const anon = createClient(url, publishable, { auth: { persistSession: false } });
const runId = `${Date.now().toString(36)}b5`;

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
let stranger: User;
let storeId: string;
let storeSlug: string;
let productId: string;
let extraId: string;
let offerId: string;
let landingA: string;
let landingB: string;

const order = async (phone: string, extra: Record<string, unknown> = {}) => {
  const { data, error } = await admin.rpc("create_cod_order", {
    p: { landing_page_id: landingA, offer_id: offerId, idempotency_key: `k-${phone}-${runId}`, first_name: "Ana", phone, district_code: "150101", address: "Av. 1", ...extra },
  });
  if (error) throw error;
  return data as { order_id: string; total: number; bumps: number };
};

beforeAll(async () => {
  owner = await createUser("owner");
  stranger = await createUser("stranger");
  storeSlug = `b5-${runId}`;
  const { data: sid } = await owner.client.rpc("create_store", { p_name: "Tienda B5", p_slug: storeSlug });
  storeId = sid as string;
  const { data: p } = await owner.client.from("products").insert({ store_id: storeId, name: "Faja", price: 100, cost: 30, status: "active" }).select("id").single();
  productId = p!.id;
  const { data: x } = await owner.client.from("products").insert({ store_id: storeId, name: "Crema", price: 30, cost: 8, status: "active", stock: 10 }).select("id").single();
  extraId = x!.id;
  const { data: o } = await owner.client.from("product_offers").insert({ store_id: storeId, product_id: productId, name: "1 u", quantity: 1, price: 100, is_default: true }).select("id").single();
  offerId = o!.id;

  // Landing A: product page con order bumps (uno atado a un producto) y upsell en gracias
  const content = landingContent.parse({
    ...createTemplate("producto"),
    form_blocks: [
      ...createTemplate("producto").form_blocks,
      {
        id: "bumps1",
        type: "form_bumps",
        title: "Agrega",
        bg: "#ffffff",
        accent: "#ea580c",
        items: [
          { id: "crema", name: "Crema reductora", price: 25, productId: extraId },
          { id: "guia", name: "Guía PDF", price: 9.9, cost: 0 },
        ],
      },
    ],
    thank_you_upsell: { enabled: true, name: "Segunda faja", price: 49, cost: 30 },
  });
  const { data: a } = await owner.client.from("landing_pages").insert({ store_id: storeId, product_id: productId, title: "A", slug: "faja-a", content }).select("id").single();
  landingA = a!.id;
  const { data: b } = await owner.client
    .from("landing_pages")
    .insert({ store_id: storeId, product_id: productId, title: "B", slug: "faja-b", content: createTemplate("clasica"), settings: { angle: "Postparto" } })
    .select("id")
    .single();
  landingB = b!.id;
  await owner.client
    .from("landing_pages")
    .update({ settings: { angle: "Dolor de espalda", ab: { enabled: true, variants: [{ landing_id: landingA, weight: 50 }, { landing_id: landingB, weight: 50 }] } } })
    .eq("id", landingA);
  await owner.client.rpc("publish_landing_page", { p_landing_id: landingA });
  await owner.client.rpc("publish_landing_page", { p_landing_id: landingB });
});

afterAll(async () => {
  if (storeId) await admin.from("stores").delete().eq("id", storeId);
  for (const u of [owner, stranger]) if (u) await admin.auth.admin.deleteUser(u.id);
});

describe("Order bumps", () => {
  it("el precio sale de la landing publicada; ids inventados se ignoran", async () => {
    const r = await order("51900000501", { bumps: ["crema", "inventado"], email: "Ana@Correo.PE" });
    expect(r.bumps).toBe(1);
    const { data } = await owner.client.from("orders").select("subtotal, product_cost_total, customer_email, order_items (kind, product_name, line_price)").eq("id", r.order_id).single();
    expect(Number(data?.subtotal)).toBe(125);
    expect(Number(data?.product_cost_total)).toBe(38); // 30 de la faja + 8 de la crema
    expect(data?.customer_email).toBe("ana@correo.pe");
    expect((data?.order_items as { kind: string }[]).map((i) => i.kind).sort()).toEqual(["bump", "main"]);
  });

  it("el bump atado a un producto descuenta su stock al confirmar", async () => {
    const r = await order("51900000502", { bumps: ["crema", "guia"] });
    await owner.client.rpc("change_order_status", { p_order_id: r.order_id, p_to: "confirmed" });
    const { data } = await owner.client.from("products").select("stock").eq("id", extraId).single();
    expect(data?.stock).toBe(9);
  });
});

describe("Upsell en la página de gracias", () => {
  it("se agrega al mismo pedido una sola vez y actualiza el saldo", async () => {
    const r = await order("51900000503");
    const add = await admin.rpc("add_order_upsell", { p_order_id: r.order_id, p_landing_id: landingA });
    expect(add.error).toBeNull();
    expect(Number(add.data.total)).toBe(149);
    expect((await admin.rpc("add_order_upsell", { p_order_id: r.order_id, p_landing_id: landingA })).error?.message).toMatch(/Ya agregaste/);
    const { data } = await owner.client.from("orders").select("total, balance_due, upsell_added").eq("id", r.order_id).single();
    expect(data).toMatchObject({ upsell_added: true });
    expect(Number(data?.balance_due)).toBe(149);
    // Otra landing no sirve para agregar
    const other = await order("51900000504");
    expect((await admin.rpc("add_order_upsell", { p_order_id: other.order_id, p_landing_id: landingB })).error).not.toBeNull();
  });
});

describe("Formularios abandonados", () => {
  it("se guardan, solo el equipo los ve y se recuperan cuando ese celular pide", async () => {
    await admin.rpc("upsert_abandoned_checkout", {
      p: { landing_page_id: landingA, session_id: `sess${runId}abc`, name: "Rosa", phone: "51900000505", district_code: "040101", offer_id: offerId },
    });
    const { data: mine } = await owner.client.from("abandoned_checkouts").select("status, province_name, offer_name").eq("store_id", storeId);
    expect(mine).toEqual([{ status: "open", province_name: "Arequipa", offer_name: "1 u" }]);
    expect((await stranger.client.from("abandoned_checkouts").select("id").eq("store_id", storeId)).data).toEqual([]);
    expect((await anon.from("abandoned_checkouts").select("id")).data ?? []).toEqual([]);

    await order("51900000505", { district_code: "040101", dni: "12345678" });
    const { data: after } = await owner.client.from("abandoned_checkouts").select("status, recovered_order_id").eq("store_id", storeId).single();
    expect(after?.status).toBe("recovered");
    expect(after?.recovered_order_id).toBeTruthy();
  });

  it("no guarda abandonados de quien acaba de pedir", async () => {
    await admin.rpc("upsert_abandoned_checkout", { p: { landing_page_id: landingA, session_id: `sess${runId}xyz`, phone: "51900000501" } });
    const { data } = await owner.client.from("abandoned_checkouts").select("id").eq("phone", "51900000501");
    expect(data).toEqual([]);
  });
});

describe("A/B y ángulos", () => {
  it("la landing pública trae las variantes publicadas y el ángulo", async () => {
    const { data } = await anon.rpc("get_public_landing", { p_store_slug: storeSlug, p_slug: "faja-a" });
    expect(data.landing.settings.angle).toBe("Dolor de espalda");
    expect((data.landing.ab_variants as { slug: string }[]).map((v) => v.slug).sort()).toEqual(["faja-a", "faja-b"]);
    const { data: b } = await anon.rpc("get_public_landing", { p_store_slug: storeSlug, p_slug: "faja-b" });
    expect(b.landing.ab_variants).toBeNull();
  });

  it("Rendimiento por ángulo agrupa los pedidos por el ángulo de su landing", async () => {
    const from = new Date(Date.now() - 86400_000).toISOString();
    const to = new Date(Date.now() + 86400_000).toISOString();
    const today = new Date().toISOString().slice(0, 10);
    const { data, error } = await owner.client.rpc("get_performance", { p_store_id: storeId, p_from: from, p_to: to, p_from_date: today, p_to_date: today, p_level: "angle" });
    expect(error).toBeNull();
    const angle = (data as { key: string; orders: number }[]).find((x) => x.key === "Dolor de espalda");
    expect(angle?.orders).toBe(5);
  });
});
