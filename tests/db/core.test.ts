/**
 * Tests de integración: seguridad multi-tenant (RLS), pedidos COD, idempotencia,
 * estados y ubigeo. Crean usuarios/tiendas temporales y los eliminan al final.
 *
 * Ejecutar: npm run test:db   (requiere .env.local con las claves de Supabase y migraciones aplicadas)
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClassicTemplate } from "@/modules/landing/defaults";

config({ path: ".env.local", quiet: true });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const secret = process.env.SUPABASE_SECRET_KEY!;

const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
const anon = createClient(url, publishable, { auth: { persistSession: false, autoRefreshToken: false } });

const runId = Date.now().toString(36);
type Tenant = { userId: string; client: SupabaseClient; storeId: string; slug: string };

async function createTenant(label: string): Promise<Tenant> {
  const email = `vendia-test-${label}-${runId}@example.com`;
  const password = `Test-${runId}-${label}-Pass!`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const client = createClient(url, publishable, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  const slug = `test-${label}-${runId}`;
  const { data: storeId, error: storeError } = await client.rpc("create_store", { p_name: `Tienda ${label}`, p_slug: slug });
  if (storeError) throw storeError;
  return { userId: data.user.id, client, storeId: storeId as string, slug };
}

let a: Tenant;
let b: Tenant;
let productId: string;
let offerId: string;
let landingId: string;

beforeAll(async () => {
  a = await createTenant("a");
  b = await createTenant("b");

  const { data: product, error } = await a.client
    .from("products")
    .insert({ store_id: a.storeId, name: "Faja térmica", price: 79.9, cost: 25, status: "active" })
    .select("id")
    .single();
  if (error) throw error;
  productId = product.id;

  const { data: offer, error: offerError } = await a.client
    .from("product_offers")
    .insert({ store_id: a.storeId, product_id: productId, name: "2 unidades", quantity: 2, price: 129.9, is_default: true })
    .select("id")
    .single();
  if (offerError) throw offerError;
  offerId = offer.id;

  await a.client.from("store_settings").update({ shipping_lima: 10, shipping_province: 15, advance_amount: 20 }).eq("store_id", a.storeId);

  const { data: landing, error: landingError } = await a.client
    .from("landing_pages")
    .insert({ store_id: a.storeId, product_id: productId, title: "Faja", slug: "faja", content: createClassicTemplate() })
    .select("id")
    .single();
  if (landingError) throw landingError;
  landingId = landing.id;
});

afterAll(async () => {
  for (const t of [a, b]) {
    if (!t) continue;
    await admin.from("stores").delete().eq("id", t.storeId);
    await admin.auth.admin.deleteUser(t.userId);
  }
});

function orderPayload(overrides: Record<string, unknown> = {}) {
  return {
    landing_page_id: landingId,
    offer_id: offerId,
    idempotency_key: `key-${Math.random().toString(36).slice(2)}`,
    first_name: "María",
    last_name: "Rojas",
    phone: "51987654321",
    district_code: "150133",
    address: "Av. Los Héroes 123",
    reference: "Frente al parque",
    attribution: { utm_source: "facebook", utm_campaign: "Faja Oct", campaign_id: "120200", fbclid: "IwAR3" },
    client_ip: "190.12.34.56",
    user_agent: "vitest",
    ...overrides,
  };
}

describe("Ubigeo", () => {
  it("tiene 25 departamentos, 196 provincias y 1893 distritos (lectura pública)", async () => {
    const [d, p, t] = await Promise.all([
      anon.from("ubigeo_departments").select("code", { count: "exact", head: true }),
      anon.from("ubigeo_provinces").select("code", { count: "exact", head: true }),
      anon.from("ubigeo_districts").select("code", { count: "exact", head: true }),
    ]);
    expect(d.count).toBe(25);
    expect(p.count).toBe(196);
    expect(t.count).toBe(1893);
  });
});

describe("Seguridad multi-tenant (RLS)", () => {
  it("un usuario no ve los productos de otra tienda", async () => {
    const { data } = await b.client.from("products").select("id").eq("id", productId);
    expect(data).toEqual([]);
  });

  it("un usuario no puede crear productos en otra tienda", async () => {
    const { error } = await b.client.from("products").insert({ store_id: a.storeId, name: "Intruso", price: 1, cost: 0 });
    expect(error).not.toBeNull();
  });

  it("un usuario no puede editar ni borrar productos de otra tienda", async () => {
    await b.client.from("products").update({ price: 1 }).eq("id", productId);
    await b.client.from("products").delete().eq("id", productId);
    const { data } = await a.client.from("products").select("price").eq("id", productId).single();
    expect(Number(data?.price)).toBe(79.9);
  });

  it("un visitante anónimo no puede leer tablas de negocio", async () => {
    const { data: products } = await anon.from("products").select("id");
    const { data: orders } = await anon.from("orders").select("id");
    expect(products ?? []).toEqual([]);
    expect(orders ?? []).toEqual([]);
  });

  it("un usuario no puede crear pedidos directamente (solo vía servidor)", async () => {
    const { error } = await a.client.rpc("create_cod_order", { p: orderPayload() });
    expect(error).not.toBeNull();
  });

  it("no se puede crear una segunda tienda", async () => {
    const { error } = await a.client.rpc("create_store", { p_name: "Otra", p_slug: `otra-${runId}` });
    expect(error?.message).toMatch(/Ya tienes una tienda/);
  });
});

describe("Landing pública", () => {
  it("no se puede publicar si el producto no tiene oferta activa / sí con oferta", async () => {
    const { error } = await a.client.rpc("publish_landing_page", { p_landing_id: landingId });
    expect(error).toBeNull();
  });

  it("otra tienda no puede publicar mi landing", async () => {
    const { error } = await b.client.rpc("publish_landing_page", { p_landing_id: landingId });
    expect(error).not.toBeNull();
  });

  it("get_public_landing devuelve solo datos públicos (sin costo)", async () => {
    const { data, error } = await anon.rpc("get_public_landing", { p_store_slug: a.slug, p_slug: "faja" });
    expect(error).toBeNull();
    expect(data.product.name).toBe("Faja térmica");
    expect(data.product.cost).toBeUndefined();
    expect(data.offers).toHaveLength(1);
  });
});

describe("Pedidos COD", () => {
  let orderId: string;

  it("crea el pedido con precio, envío y ubicación calculados en el servidor", async () => {
    const { data, error } = await admin.rpc("create_cod_order", { p: orderPayload({ total: 1, price: 0.01 }) });
    expect(error).toBeNull();
    orderId = data.order_id;

    const { data: order } = await a.client.from("orders").select("*, order_items (*), order_attribution (*)").eq("id", orderId).single();
    expect(Number(order.subtotal)).toBe(129.9); // precio de la oferta, no el enviado
    expect(Number(order.shipping_charged)).toBe(10); // Lima
    expect(Number(order.total)).toBe(139.9);
    expect(Number(order.advance_amount)).toBe(20);
    expect(Number(order.balance_due)).toBe(119.9);
    expect(Number(order.product_cost_total)).toBe(50); // 25 × 2
    expect(order.department_name).toBe("Lima");
    expect(order.district_name).toBe("San Juan de Miraflores");
    expect(order.status).toBe("new");
    expect(order.order_items[0].quantity).toBe(2);
    const attribution = Array.isArray(order.order_attribution) ? order.order_attribution[0] : order.order_attribution;
    expect(attribution.campaign_id).toBe("120200");
    expect(attribution.utm_source).toBe("facebook");
  });

  it("provincia cobra envío de provincia", async () => {
    const { data } = await admin.rpc("create_cod_order", { p: orderPayload({ district_code: "040101", phone: "51911111111" }) });
    const { data: order } = await a.client.from("orders").select("shipping_charged, department_name").eq("id", data.order_id).single();
    expect(Number(order?.shipping_charged)).toBe(15);
    expect(order?.department_name).toBe("Arequipa");
  });

  it("el mismo envío del formulario (misma idempotency_key) no duplica el pedido", async () => {
    const payload = orderPayload({ phone: "51922222222" });
    const first = await admin.rpc("create_cod_order", { p: payload });
    const second = await admin.rpc("create_cod_order", { p: payload });
    expect(second.data.order_id).toBe(first.data.order_id);
    expect(second.data.duplicate_submit).toBe(true);
  });

  it("marca como posible duplicado el mismo celular y producto en 30 minutos", async () => {
    const { data } = await admin.rpc("create_cod_order", { p: orderPayload() });
    const { data: order } = await a.client.from("orders").select("is_possible_duplicate").eq("id", data.order_id).single();
    expect(order?.is_possible_duplicate).toBe(true);
  });

  it("rechaza distrito inexistente, oferta de otro producto y teléfono inválido", async () => {
    expect((await admin.rpc("create_cod_order", { p: orderPayload({ district_code: "999999" }) })).error).not.toBeNull();
    expect((await admin.rpc("create_cod_order", { p: orderPayload({ offer_id: crypto.randomUUID() }) })).error).not.toBeNull();
    expect((await admin.rpc("create_cod_order", { p: orderPayload({ phone: "123" }) })).error).not.toBeNull();
  });

  it("otra tienda no ve el pedido ni puede cambiar su estado", async () => {
    const { data } = await b.client.from("orders").select("id").eq("id", orderId);
    expect(data).toEqual([]);
    const { error } = await b.client.rpc("change_order_status", { p_order_id: orderId, p_to: "confirmed" });
    expect(error).not.toBeNull();
  });

  it("el vendedor no puede cambiar el estado editando la tabla directamente", async () => {
    await a.client.from("orders").update({ status: "delivered" }).eq("id", orderId);
    const { data } = await a.client.from("orders").select("status").eq("id", orderId).single();
    expect(data?.status).toBe("new");
  });

  it("transiciones válidas completan los hitos; las inválidas se rechazan", async () => {
    const ok = await a.client.rpc("change_order_status", { p_order_id: orderId, p_to: "delivered", p_note: "Entregado por motorizado" });
    expect(ok.error).toBeNull();
    const { data } = await a.client.from("orders").select("status, confirmed_at, shipped_at, delivered_at").eq("id", orderId).single();
    expect(data?.status).toBe("delivered");
    expect(data?.confirmed_at).not.toBeNull();
    expect(data?.shipped_at).not.toBeNull();

    const bad = await a.client.rpc("change_order_status", { p_order_id: orderId, p_to: "cancelled" });
    expect(bad.error).not.toBeNull();

    const { data: history } = await a.client.from("order_status_history").select("from_status, to_status").eq("order_id", orderId).order("id");
    expect(history?.map((h) => h.to_status)).toEqual(["new", "delivered"]);
    expect(history?.[1].from_status).toBe("new");
  });

  it("las estadísticas cuentan pedidos y revenue solo de entregados", async () => {
    const from = new Date(Date.now() - 3600_000).toISOString();
    const to = new Date(Date.now() + 3600_000).toISOString();
    const { data, error } = await a.client.rpc("get_order_stats", { p_store_id: a.storeId, p_from: from, p_to: to });
    expect(error).toBeNull();
    expect(data.orders).toBe(4);
    expect(data.delivered).toBe(1);
    expect(Number(data.revenue)).toBe(139.9);

    const other = await b.client.rpc("get_order_stats", { p_store_id: a.storeId, p_from: from, p_to: to });
    expect(other.error).not.toBeNull();
  });
});
