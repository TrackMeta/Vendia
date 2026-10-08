/**
 * Bloque 1 — Controlador de pedidos: roles, notificaciones, contacto, pedido manual, equipo.
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
const runId = `${Date.now().toString(36)}b1`;

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

const newLandingOrder = async (phone: string, district = "150133") => {
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
    },
  });
  if (error) throw error;
  return data as { order_id: string; order_number: number };
};

beforeAll(async () => {
  owner = await createUser("owner");
  staff = await createUser("staff");
  stranger = await createUser("stranger");
  const { data: sid, error } = await owner.client.rpc("create_store", { p_name: "Tienda B1", p_slug: `b1-${runId}` });
  if (error) throw error;
  storeId = sid as string;
  const { data: p } = await owner.client.from("products").insert({ store_id: storeId, name: "Faja", price: 79.9, cost: 20, status: "active" }).select("id").single();
  productId = p!.id;
  const { data: o } = await owner.client.from("product_offers").insert({ store_id: storeId, product_id: productId, name: "1 unidad", quantity: 1, price: 79.9, is_default: true }).select("id").single();
  offerId = o!.id;
  const { data: l } = await owner.client.from("landing_pages").insert({ store_id: storeId, product_id: productId, title: "Faja", slug: "faja", content: createClassicTemplate() }).select("id").single();
  landingId = l!.id;
  await owner.client.rpc("publish_landing_page", { p_landing_id: landingId });
});

afterAll(async () => {
  if (storeId) await admin.from("stores").delete().eq("id", storeId);
  for (const u of [owner, staff, stranger]) if (u) await admin.auth.admin.deleteUser(u.id);
});

describe("Equipo e invitaciones", () => {
  it("solo el dueño invita; la invitación exige el mismo correo", async () => {
    const { data: token, error } = await owner.client.rpc("create_store_invitation", { p_store_id: storeId, p_email: staff.email });
    expect(error).toBeNull();
    // otra persona con el enlace no puede usarlo
    const wrong = await stranger.client.rpc("accept_store_invitation", { p_token: token });
    expect(wrong.error?.message).toMatch(/es para/);
    // el invitado sí
    const ok = await staff.client.rpc("accept_store_invitation", { p_token: token });
    expect(ok.error).toBeNull();
    expect((await staff.client.rpc("my_store_role", { p_store_id: storeId })).data).toBe("staff");
    // no se puede reutilizar
    expect((await staff.client.rpc("accept_store_invitation", { p_token: token })).error).not.toBeNull();
    // el confirmador no puede invitar
    expect((await staff.client.rpc("create_store_invitation", { p_store_id: storeId, p_email: "x@example.com" })).error).not.toBeNull();
  });

  it("get_store_team muestra al dueño y al confirmador", async () => {
    const { data } = await staff.client.rpc("get_store_team", { p_store_id: storeId });
    expect((data as { role: string }[]).map((m) => m.role).sort()).toEqual(["owner", "staff"]);
    const outsider = await stranger.client.rpc("get_store_team", { p_store_id: storeId });
    expect(outsider.data).toEqual([]);
  });
});

describe("Permisos del Confirmador (RLS real)", () => {
  it("no ve gastos ni configuración de Meta", async () => {
    await owner.client.from("expenses").insert({ store_id: storeId, expense_date: "2026-10-08", category: "meta_ads", amount: 50 });
    const { data: exp } = await staff.client.from("expenses").select("id").eq("store_id", storeId);
    expect(exp).toEqual([]);
    expect((await staff.client.rpc("get_expense_totals", { p_store_id: storeId, p_from: "2026-10-01", p_to: "2026-10-31" })).error).not.toBeNull();
    const { data: meta } = await staff.client.from("store_meta_settings").select("pixel_id").eq("store_id", storeId);
    expect(meta).toEqual([]);
  });

  it("puede ver productos pero no editarlos ni publicar landings", async () => {
    const { data } = await staff.client.from("products").select("id").eq("id", productId);
    expect(data).toHaveLength(1);
    await staff.client.from("products").update({ price: 1 }).eq("id", productId);
    const { data: after } = await owner.client.from("products").select("price").eq("id", productId).single();
    expect(Number(after?.price)).toBe(79.9);
    expect((await staff.client.rpc("unpublish_landing_page", { p_landing_id: landingId })).error).not.toBeNull();
  });
});

describe("Notificaciones", () => {
  it("un pedido de la landing crea una notificación visible para todo el equipo, con lectura por usuario", async () => {
    const o = await newLandingOrder("51900000101");
    const { data: forStaff } = await staff.client.from("notifications").select("title, type, order_id").eq("order_id", o.order_id);
    expect(forStaff?.[0]).toMatchObject({ type: "new_order", title: `Nuevo pedido #${o.order_number}` });
    const { data: forStranger } = await stranger.client.from("notifications").select("id").eq("order_id", o.order_id);
    expect(forStranger).toEqual([]);

    const before = (await staff.client.rpc("unread_notifications_count", { p_store_id: storeId })).data as number;
    expect(before).toBeGreaterThan(0);
    await staff.client.rpc("mark_notifications_read", { p_store_id: storeId, p_ids: null });
    expect((await staff.client.rpc("unread_notifications_count", { p_store_id: storeId })).data).toBe(0);
    // la lectura es por persona: el dueño sigue con sus no leídas
    expect((await owner.client.rpc("unread_notifications_count", { p_store_id: storeId })).data).toBeGreaterThan(0);
  });
});

describe("Secuencia de contacto", () => {
  it("registra intentos seguidos, avisa al terminar y NO cancela solo", async () => {
    const o = await newLandingOrder("51900000102", "040101");
    const { data: z } = await staff.client.from("orders").select("zone").eq("id", o.order_id).single();
    expect(z?.zone).toBe("provincia");
    for (const [channel, result] of [["call", "no_answer"], ["call", "phone_off"], ["call", "no_answer"], ["whatsapp", "no_answer"]] as const) {
      const { error } = await staff.client.rpc("log_contact_attempt", { p_order_id: o.order_id, p_channel: channel, p_result: result });
      expect(error).toBeNull();
    }
    const { data: order } = await staff.client.from("orders").select("status, contact_attempts, contact_sequence_done, assigned_to").eq("id", o.order_id).single();
    expect(order).toMatchObject({ status: "pending_confirmation", contact_attempts: 4, contact_sequence_done: true, assigned_to: staff.id });
    const { data: notif } = await owner.client.from("notifications").select("type").eq("order_id", o.order_id).eq("type", "sequence_done");
    expect(notif).toHaveLength(1);
    const { data: attempts } = await owner.client.from("order_contact_attempts").select("attempt_number").eq("order_id", o.order_id);
    expect(attempts).toHaveLength(4);
  });

  it("se puede cancelar desde la primera llamada con motivo", async () => {
    const o = await newLandingOrder("51900000103");
    const { data } = await staff.client.rpc("log_contact_attempt", { p_order_id: o.order_id, p_channel: "call", p_result: "rejected", p_cancel_reason: "precio" });
    expect(data.status).toBe("cancelled");
    const { data: order } = await owner.client.from("orders").select("cancel_reason").eq("id", o.order_id).single();
    expect(order?.cancel_reason).toBe("precio");
  });

  it("«llamar después» exige hora y la guarda", async () => {
    const o = await newLandingOrder("51900000104");
    expect((await staff.client.rpc("log_contact_attempt", { p_order_id: o.order_id, p_channel: "call", p_result: "call_later" })).error).not.toBeNull();
    const when = new Date(Date.now() + 3 * 3600_000).toISOString();
    const { error } = await staff.client.rpc("log_contact_attempt", { p_order_id: o.order_id, p_channel: "call", p_result: "call_later", p_next_contact_at: when });
    expect(error).toBeNull();
    const { data } = await staff.client.from("orders").select("next_contact_at").eq("id", o.order_id).single();
    expect(Date.parse(data!.next_contact_at)).toBe(Date.parse(when));
  });

  it("una persona de otra tienda no puede registrar intentos", async () => {
    const o = await newLandingOrder("51900000105");
    expect((await stranger.client.rpc("log_contact_attempt", { p_order_id: o.order_id, p_channel: "call", p_result: "confirmed" })).error).not.toBeNull();
  });
});

describe("Pedido manual y asignación", () => {
  it("el confirmador registra un pedido manual ya confirmado, con precio acordado", async () => {
    const { data, error } = await staff.client.rpc("create_manual_order", {
      p: {
        store_id: storeId,
        product_id: productId,
        quantity: 2,
        subtotal: 140,
        first_name: "Rosa",
        phone: "51900000106",
        district_code: "150101",
        address: "Jr. Lima 1",
        source_channel: "whatsapp",
        already_confirmed: true,
        idempotency_key: `manual-${runId}`,
      },
    });
    expect(error).toBeNull();
    const { data: order } = await owner.client.from("orders").select("source, source_channel, status, subtotal, assigned_to").eq("id", data.order_id).single();
    expect(order).toMatchObject({ source: "manual", source_channel: "whatsapp", status: "confirmed", assigned_to: staff.id });
    expect(Number(order?.subtotal)).toBe(140);
    // no genera notificación de «pedido nuevo» (lo creó el equipo)
    const { data: notif } = await owner.client.from("notifications").select("id").eq("order_id", data.order_id);
    expect(notif).toEqual([]);
  });

  it("asignar solo a miembros del equipo", async () => {
    const o = await newLandingOrder("51900000107");
    expect((await owner.client.rpc("assign_orders", { p_order_ids: [o.order_id], p_user_id: staff.id })).error).toBeNull();
    expect((await owner.client.rpc("assign_orders", { p_order_ids: [o.order_id], p_user_id: stranger.id })).error).not.toBeNull();
  });

  it("al quitar al confirmador se liberan sus pedidos", async () => {
    expect((await staff.client.rpc("remove_store_member", { p_store_id: storeId, p_user_id: staff.id })).error).not.toBeNull();
    expect((await owner.client.rpc("remove_store_member", { p_store_id: storeId, p_user_id: staff.id })).error).toBeNull();
    const { data } = await owner.client.from("orders").select("id").eq("store_id", storeId).eq("assigned_to", staff.id);
    expect(data).toEqual([]);
  });
});
