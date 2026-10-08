/**
 * Bloque 7 — Operación y equipo: variantes con stock, comisiones, métricas por confirmador,
 * embalaje, liquidación con el courier y contadores. Ejecutar: npm run test:db
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTemplate } from "@/modules/landing/defaults";

config({ path: ".env.local", quiet: true });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const admin = createClient(url, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
const runId = `${Date.now().toString(36)}b7`;

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
let productId: string;
let offerId: string;
let landingId: string;
let vM: string;
let vL: string;
const from = new Date(Date.now() - 86400_000).toISOString();
const to = new Date(Date.now() + 86400_000).toISOString();

const newOrder = async (phone: string, district = "150101") => {
  const { data, error } = await admin.rpc("create_cod_order", {
    p: { landing_page_id: landingId, offer_id: offerId, idempotency_key: `k-${phone}-${runId}`, first_name: "Cliente", phone, district_code: district, address: "Av. 1", dni: "12345678" },
  });
  if (error) throw error;
  return (data as { order_id: string }).order_id;
};

beforeAll(async () => {
  owner = await createUser("owner");
  staff = await createUser("staff");
  const { data: sid } = await owner.client.rpc("create_store", { p_name: "Tienda B7", p_slug: `b7-${runId}` });
  storeId = sid as string;
  const { data: token } = await owner.client.rpc("create_store_invitation", { p_store_id: storeId, p_email: staff.email });
  await staff.client.rpc("accept_store_invitation", { p_token: token });
  await owner.client.from("store_settings").update({ packaging_cost: 1.5 }).eq("store_id", storeId);
  const { data: p } = await owner.client.from("products").insert({ store_id: storeId, name: "Faja", price: 100, cost: 30, status: "active", variant_label: "Talla" }).select("id").single();
  productId = p!.id;
  const { data: o } = await owner.client.from("product_offers").insert({ store_id: storeId, product_id: productId, name: "2 unidades", quantity: 2, price: 150, is_default: true }).select("id").single();
  offerId = o!.id;
  const { data: vs } = await owner.client
    .from("product_variants")
    .insert([
      { store_id: storeId, product_id: productId, name: "M", stock: 3, position: 0 },
      { store_id: storeId, product_id: productId, name: "L", stock: 1, position: 1 },
    ])
    .select("id, name");
  vM = vs!.find((v) => v.name === "M")!.id;
  vL = vs!.find((v) => v.name === "L")!.id;
  const { data: l } = await owner.client.from("landing_pages").insert({ store_id: storeId, product_id: productId, title: "Faja", slug: "faja", content: createTemplate("clasica") }).select("id").single();
  landingId = l!.id;
  await owner.client.rpc("publish_landing_page", { p_landing_id: landingId });
  // Comisión del confirmador
  await owner.client.rpc("update_member_settings", { p_store_id: storeId, p_user_id: staff.id, p_color: "#16a34a", p_commission_lima: 2, p_commission_province: 3 });
});

afterAll(async () => {
  if (storeId) await admin.from("stores").delete().eq("id", storeId);
  for (const u of [owner, staff]) if (u) await admin.auth.admin.deleteUser(u.id);
});

describe("Variantes", () => {
  it("la landing pública las muestra y el confirmador solo las ve (no las edita)", async () => {
    const anon = createClient(url, publishable, { auth: { persistSession: false } });
    const { data } = await anon.rpc("get_public_landing", { p_store_slug: `b7-${runId}`, p_slug: "faja" });
    expect(data.product.variant_label).toBe("Talla");
    expect((data.product.variants as { name: string }[]).map((v) => v.name)).toEqual(["M", "L"]);
    expect((await staff.client.from("product_variants").select("id").eq("product_id", productId)).data).toHaveLength(2);
    await staff.client.from("product_variants").update({ stock: 99 }).eq("id", vM);
    expect((await owner.client.from("product_variants").select("stock").eq("id", vM).single()).data?.stock).toBe(3);
  });

  it("una variante por unidad; el stock sale de cada variante al confirmar", async () => {
    const id = await newOrder("51900000701");
    expect((await admin.rpc("set_order_variants", { p_order_id: id, p_variant_ids: [vM] })).error?.message).toMatch(/una por unidad/);
    expect((await admin.rpc("set_order_variants", { p_order_id: id, p_variant_ids: [vM, vL] })).error).toBeNull();
    expect((await staff.client.rpc("change_order_status", { p_order_id: id, p_to: "confirmed" })).error).toBeNull();
    const { data } = await owner.client.from("product_variants").select("name, stock").eq("product_id", productId).order("position");
    expect(data).toEqual([
      { name: "M", stock: 2 },
      { name: "L", stock: 0 },
    ]);
    // L agotada: otro pedido no puede confirmarse con L
    const other = await newOrder("51900000702");
    await admin.rpc("set_order_variants", { p_order_id: other, p_variant_ids: [vL, vL] });
    expect((await staff.client.rpc("change_order_status", { p_order_id: other, p_to: "confirmed" })).error?.message).toMatch(/Sin stock/);
  });
});

describe("Comisiones, embalaje y métricas", () => {
  it("quien confirma gana su comisión según la zona; el embalaje se suma por unidad", async () => {
    const { data } = await owner.client.from("orders").select("confirmed_by, commission_amount, packaging_cost").eq("store_id", storeId).not("confirmed_by", "is", null);
    expect(data).toEqual([{ confirmed_by: staff.id, commission_amount: 2, packaging_cost: 3 }]);
  });

  it("si el pedido no se entrega, la comisión se anula", async () => {
    const prov = await newOrder("51900000703", "040101");
    await admin.rpc("set_order_variants", { p_order_id: prov, p_variant_ids: [vM, vM] });
    await staff.client.rpc("change_order_status", { p_order_id: prov, p_to: "confirmed" });
    await owner.client.rpc("change_order_status", { p_order_id: prov, p_to: "shipped" });
    await owner.client.rpc("change_order_status", { p_order_id: prov, p_to: "failed_delivery", p_reason: "no_recogio" });
    const { data } = await owner.client.rpc("get_commissions", { p_store_id: storeId });
    const mine = (data as { user_id: string; generated: number; annulled: number }[]).find((r) => r.user_id === staff.id)!;
    expect(Number(mine.generated)).toBe(2);
    expect(Number(mine.annulled)).toBe(3);
  });

  it("el confirmador ve solo sus números y pagos; solo el dueño registra pagos", async () => {
    expect((await staff.client.from("commission_payments").insert({ store_id: storeId, user_id: staff.id, amount: 5 })).error).not.toBeNull();
    expect((await owner.client.from("commission_payments").insert({ store_id: storeId, user_id: staff.id, amount: 1 })).error).toBeNull();
    expect((await staff.client.from("commission_payments").select("amount")).data?.map((p) => Number(p.amount))).toEqual([1]);
    const { data: own } = await staff.client.rpc("get_commissions", { p_store_id: storeId });
    expect((own as { user_id: string }[]).map((r) => r.user_id)).toEqual([staff.id]);
    const { data: metrics } = await staff.client.rpc("get_team_metrics", { p_store_id: storeId, p_from: from, p_to: to });
    expect(metrics).toHaveLength(1);
    expect(metrics[0]).toMatchObject({ user_id: staff.id, confirmed: 2 });
    const { data: all } = await owner.client.rpc("get_team_metrics", { p_store_id: storeId, p_from: from, p_to: to });
    expect(all).toHaveLength(2);
  });
});

describe("Liquidación y contadores", () => {
  it("solo el dueño liquida; el pedido pasa a Cobrado y se puede anular", async () => {
    const lima = (await owner.client.from("orders").select("id").eq("store_id", storeId).eq("confirmed_by", staff.id).eq("zone", "lima").single()).data!.id;
    await owner.client.rpc("change_orders_status", { p_order_ids: [lima], p_to: "delivered" });
    expect((await staff.client.rpc("settle_orders", { p_store_id: storeId, p_order_ids: [lima] })).error).not.toBeNull();
    const { data, error } = await owner.client.rpc("settle_orders", { p_store_id: storeId, p_order_ids: [lima], p_note: "Eva" });
    expect(error).toBeNull();
    expect(Number(data.net)).toBe(Number(data.gross) - Number(data.shipping));
    expect((await owner.client.from("orders").select("status").eq("id", lima).single()).data?.status).toBe("collected");
    expect((await owner.client.rpc("undo_settlement", { p_settlement_id: data.settlement_id })).data).toBe(1);
    expect((await owner.client.from("orders").select("status, settled_at").eq("id", lima).single()).data).toEqual({ status: "delivered", settled_at: null });
  });

  it("los contadores se calculan en la base", async () => {
    const { data } = await staff.client.rpc("order_status_counts", { p_store_id: storeId });
    expect(Object.values(data as Record<string, number>).reduce((s, n) => s + Number(n), 0)).toBe(3);
    const { data: lg } = await staff.client.rpc("logistics_counts", { p_store_id: storeId });
    expect(lg).toMatchObject({ confirmar: 1, despachar: 0, en_camino: 0 });
  });
});
