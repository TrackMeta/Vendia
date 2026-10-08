/**
 * Bloque 2 — Provincia y despacho: couriers, estados por zona, stock, pagos con comprobante,
 * exportación atómica. Ejecutar: npm run test:db
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClassicTemplate } from "@/modules/landing/defaults";

config({ path: ".env.local", quiet: true });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const admin = createClient(url, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
const runId = `${Date.now().toString(36)}b2`;

type User = { id: string; email: string; client: SupabaseClient };

async function createUser(label: string): Promise<User> {
  const email = `vendia-test-${label}-${runId}@example.com`;
  const password = `Test-${runId}-${label}-Pass!`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const client = createClient(url, publishable, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: e2 } = await client.auth.signInWithPassword({ email, password });
  if (e2) throw e2;
  return { id: data.user.id, email, client };
}

let owner: User;
let staff: User;
let stranger: User;
let storeId: string;
let productId: string;
let offerId: string;
let landingId: string;

const newOrder = async (phone: string, district: string, dni?: string) => {
  const { data, error } = await admin.rpc("create_cod_order", {
    p: {
      landing_page_id: landingId,
      offer_id: offerId,
      idempotency_key: `k-${phone}-${runId}`,
      first_name: "Cliente",
      last_name: "Prueba",
      phone,
      district_code: district,
      address: "Av. Prueba 1",
      ...(dni ? { dni } : {}),
    },
  });
  if (error) throw error;
  return data as { order_id: string; order_number: number };
};

const stock = async () => (await admin.from("products").select("stock").eq("id", productId).single()).data?.stock as number;

beforeAll(async () => {
  owner = await createUser("owner");
  staff = await createUser("staff");
  stranger = await createUser("stranger");
  const { data: sid, error } = await owner.client.rpc("create_store", { p_name: "Tienda B2", p_slug: `b2-${runId}` });
  if (error) throw error;
  storeId = sid as string;
  await owner.client.from("store_settings").update({ advance_amount: 20, shipping_province: 10 }).eq("store_id", storeId);
  const { data: p } = await owner.client
    .from("products")
    .insert({ store_id: storeId, name: "Faja", price: 79.9, cost: 20, status: "active", stock: 10 })
    .select("id")
    .single();
  productId = p!.id;
  const { data: o } = await owner.client
    .from("product_offers")
    .insert({ store_id: storeId, product_id: productId, name: "2 unidades", quantity: 2, price: 129.9, is_default: true })
    .select("id")
    .single();
  offerId = o!.id;
  const { data: l } = await owner.client
    .from("landing_pages")
    .insert({ store_id: storeId, product_id: productId, title: "Faja", slug: "faja", content: createClassicTemplate() })
    .select("id")
    .single();
  landingId = l!.id;
  await owner.client.rpc("publish_landing_page", { p_landing_id: landingId });
  const { data: token } = await owner.client.rpc("create_store_invitation", { p_store_id: storeId, p_email: staff.email });
  await staff.client.rpc("accept_store_invitation", { p_token: token });
});

afterAll(async () => {
  if (storeId) {
    const { data: files } = await admin.storage.from("order-receipts").list(storeId, { limit: 100 });
    for (const folder of files ?? []) {
      const { data: inner } = await admin.storage.from("order-receipts").list(`${storeId}/${folder.name}`);
      if (inner?.length) await admin.storage.from("order-receipts").remove(inner.map((f) => `${storeId}/${folder.name}/${f.name}`));
    }
    await admin.from("stores").delete().eq("id", storeId);
  }
  for (const u of [owner, staff, stranger]) if (u) await admin.auth.admin.deleteUser(u.id);
});

describe("Couriers por tienda", () => {
  it("una tienda nueva trae Eva (Lima) y Shalom (provincia); solo el dueño los edita", async () => {
    const { data } = await staff.client.from("store_couriers").select("courier_id, zone, is_default").eq("store_id", storeId).order("courier_id");
    expect(data).toEqual([
      { courier_id: "eva", zone: "lima", is_default: true },
      { courier_id: "shalom", zone: "provincia", is_default: true },
    ]);
    await staff.client.from("store_couriers").update({ shipping_cost: 99 }).eq("store_id", storeId).eq("courier_id", "eva");
    const { data: eva } = await owner.client.from("store_couriers").select("shipping_cost").eq("store_id", storeId).eq("courier_id", "eva").single();
    expect(Number(eva?.shipping_cost)).toBe(10);
    expect((await stranger.client.from("store_couriers").select("courier_id").eq("store_id", storeId)).data).toEqual([]);
  });
});

describe("Adelanto solo en provincia", () => {
  it("Lima va sin adelanto; provincia con el adelanto configurado", async () => {
    const lima = await newOrder("51900000201", "150101");
    const prov = await newOrder("51900000202", "040101", "12345678");
    const { data } = await owner.client.from("orders").select("id, zone, advance_amount, balance_due, total").in("id", [lima.order_id, prov.order_id]);
    const l = data!.find((o) => o.id === lima.order_id)!;
    const p = data!.find((o) => o.id === prov.order_id)!;
    expect(l.zone).toBe("lima");
    expect(Number(l.advance_amount)).toBe(0);
    expect(Number(l.balance_due)).toBe(Number(l.total));
    expect(p.zone).toBe("provincia");
    expect(Number(p.advance_amount)).toBe(20);
  });
});

describe("Stock y estados por zona", () => {
  it("provincia: confirmar descuenta stock; Enviado → En agencia → Cobrado → Entregado", async () => {
    const before = await stock();
    const o = await newOrder("51900000203", "080101", "87654321");
    expect((await staff.client.rpc("change_order_status", { p_order_id: o.order_id, p_to: "confirmed" })).error).toBeNull();
    expect(await stock()).toBe(before - 2);
    const { data: c } = await staff.client.from("orders").select("courier_id, shipping_cost").eq("id", o.order_id).single();
    expect(c).toMatchObject({ courier_id: "shalom" });
    expect(Number(c?.shipping_cost)).toBe(15);

    for (const to of ["shipped", "at_agency", "collected"]) {
      expect((await staff.client.rpc("change_order_status", { p_order_id: o.order_id, p_to: to })).error).toBeNull();
    }
    const { data: mid } = await owner.client.from("orders").select("at_agency_at, collected_at, delivered_at").eq("id", o.order_id).single();
    expect(mid?.at_agency_at).toBeTruthy();
    expect(mid?.collected_at).toBeTruthy();
    expect(mid?.delivered_at).toBeNull(); // en provincia, cobrado NO implica entregado
    expect((await staff.client.rpc("change_order_status", { p_order_id: o.order_id, p_to: "delivered" })).error).toBeNull();
  });

  it("Lima: no pasa por agencia; no entregado devuelve el stock una sola vez", async () => {
    const o = await newOrder("51900000204", "150133");
    await staff.client.rpc("change_order_status", { p_order_id: o.order_id, p_to: "shipped" });
    const shipped = await stock();
    expect((await staff.client.rpc("change_order_status", { p_order_id: o.order_id, p_to: "at_agency" })).error).not.toBeNull();
    await staff.client.rpc("change_order_status", { p_order_id: o.order_id, p_to: "failed_delivery", p_reason: "rechazo_en_puerta" });
    expect(await stock()).toBe(shipped + 2);
    await staff.client.rpc("change_order_status", { p_order_id: o.order_id, p_to: "returned" });
    expect(await stock()).toBe(shipped + 2);
    const { data } = await owner.client.from("orders").select("return_shipments").eq("id", o.order_id).single();
    expect(data?.return_shipments).toBe(1); // Eva: 1 envío por defecto
  });

  it("sin stock suficiente no se confirma; cancelar devuelve lo reservado", async () => {
    await owner.client.from("products").update({ stock: 1 }).eq("id", productId);
    const o = await newOrder("51900000205", "150101");
    const r = await staff.client.rpc("change_order_status", { p_order_id: o.order_id, p_to: "confirmed" });
    expect(r.error?.message).toMatch(/Sin stock suficiente/);
    await owner.client.from("products").update({ stock: 5 }).eq("id", productId);
    await staff.client.rpc("change_order_status", { p_order_id: o.order_id, p_to: "confirmed" });
    expect(await stock()).toBe(3);
    await staff.client.rpc("change_order_status", { p_order_id: o.order_id, p_to: "cancelled", p_reason: "ya_no_lo_quiere" });
    expect(await stock()).toBe(5);
    const { data: n } = await owner.client.from("notifications").select("type").eq("store_id", storeId).eq("type", "low_stock");
    expect(n?.length).toBeGreaterThan(0);
  });
});

describe("Datos de envío y pagos con comprobante", () => {
  it("el equipo guarda agencia y clave de recojo; otra tienda no ve nada", async () => {
    const o = await newOrder("51900000206", "030101", "11223344");
    const { error } = await staff.client
      .from("orders")
      .update({ agency_destination: "ABANCAY", pickup_key: "4821", courier_order_number: "OR-77", package_size: "PAQUETE M" })
      .eq("id", o.order_id);
    expect(error).toBeNull();
    const { data } = await owner.client.from("orders").select("agency_destination, pickup_key").eq("id", o.order_id).single();
    expect(data).toEqual({ agency_destination: "ABANCAY", pickup_key: "4821" });
    expect((await stranger.client.from("orders").select("pickup_key").eq("id", o.order_id)).data).toEqual([]);
  });

  it("comprobante en bucket privado; el adelanto del pedido se sincroniza con los pagos", async () => {
    const o = await newOrder("51900000207", "040101", "22334455");
    const path = `${storeId}/${o.order_id}/comprobante.png`;
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    expect((await staff.client.storage.from("order-receipts").upload(path, png, { contentType: "image/png" })).error).toBeNull();
    // Otra tienda no puede subir ni leer
    expect((await stranger.client.storage.from("order-receipts").upload(`${storeId}/${o.order_id}/x.png`, png, { contentType: "image/png" })).error).not.toBeNull();
    expect((await stranger.client.storage.from("order-receipts").download(path)).error).not.toBeNull();
    // Sin sesión tampoco (bucket privado)
    const anon = createClient(url, publishable, { auth: { persistSession: false } });
    expect((await anon.storage.from("order-receipts").download(path)).error).not.toBeNull();

    const { data: pay, error } = await staff.client
      .from("order_payments")
      .insert({ store_id: storeId, order_id: o.order_id, kind: "advance", amount: 35, method: "yape", receipt_path: path })
      .select("id")
      .single();
    expect(error).toBeNull();
    const { data: ord } = await owner.client.from("orders").select("advance_amount, balance_due, total").eq("id", o.order_id).single();
    expect(Number(ord?.advance_amount)).toBe(35);
    expect(Number(ord?.balance_due)).toBe(Number(ord?.total) - 35);

    expect((await staff.client.rpc("verify_order_payment", { p_payment_id: pay!.id })).error).toBeNull();
    // Verificado: el confirmador ya no lo borra; el dueño sí
    await staff.client.from("order_payments").delete().eq("id", pay!.id);
    expect((await owner.client.from("order_payments").select("id").eq("id", pay!.id)).data).toHaveLength(1);
    await owner.client.from("order_payments").delete().eq("id", pay!.id);
    const { data: after } = await owner.client.from("orders").select("advance_amount").eq("id", o.order_id).single();
    expect(Number(after?.advance_amount)).toBe(20); // vuelve al adelanto configurado
    // Un pago con comprobante de otra tienda no se acepta
    const bad = await stranger.client
      .from("order_payments")
      .insert({ store_id: storeId, order_id: o.order_id, kind: "balance", amount: 10, method: "yape" });
    expect(bad.error).not.toBeNull();
  });
});

describe("Exportación atómica", () => {
  it("reserva una sola vez, crea el lote y marca Enviado", async () => {
    const a = await newOrder("51900000208", "040101", "33445566");
    const b = await newOrder("51900000209", "040101", "44556677");
    for (const id of [a.order_id, b.order_id]) await staff.client.rpc("change_order_status", { p_order_id: id, p_to: "confirmed" });

    const first = await staff.client.rpc("reserve_orders_for_export", {
      p_store_id: storeId,
      p_courier_id: "shalom",
      p_order_ids: [a.order_id],
      p_origin_agency: "ATOCONGO",
      p_mark_shipped: true,
    });
    expect(first.error).toBeNull();
    // Segundo intento con el mismo pedido + uno nuevo: solo toma el nuevo
    const second = await owner.client.rpc("reserve_orders_for_export", {
      p_store_id: storeId,
      p_courier_id: "shalom",
      p_order_ids: [a.order_id, b.order_id],
      p_mark_shipped: false,
    });
    expect(second.error).toBeNull();
    expect(second.data.order_ids).toEqual([b.order_id]);
    expect(second.data.skipped).toBe(1);
    // Repetir solo el ya exportado falla
    expect((await owner.client.rpc("reserve_orders_for_export", { p_store_id: storeId, p_courier_id: "shalom", p_order_ids: [a.order_id] })).error).not.toBeNull();

    const { data: orders } = await owner.client.from("orders").select("id, status, export_batch_id, agency_origin").in("id", [a.order_id, b.order_id]);
    const oa = orders!.find((x) => x.id === a.order_id)!;
    const ob = orders!.find((x) => x.id === b.order_id)!;
    expect(oa).toMatchObject({ status: "shipped", export_batch_id: first.data.batch_id, agency_origin: "ATOCONGO" });
    expect(ob.status).toBe("confirmed");
    const { data: batches } = await staff.client.from("export_batches").select("order_count").eq("store_id", storeId);
    expect(batches?.map((x) => x.order_count).sort()).toEqual([1, 1]);
    // Otra tienda no exporta pedidos ajenos
    expect((await stranger.client.rpc("reserve_orders_for_export", { p_store_id: storeId, p_courier_id: "shalom", p_order_ids: [b.order_id] })).error).not.toBeNull();
  });
});
