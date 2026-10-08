"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { requireStore } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { maybeSendPurchase } from "@/modules/meta/capi";
import { CANCEL_REASONS, CONTACT_RESULTS, FAILURE_REASONS } from "@/modules/orders/contact";
import { orderInput } from "@/modules/orders/order-input";
import { ORDER_STATUSES } from "@/modules/orders/state-machine";

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

const REASONS = [...Object.keys(CANCEL_REASONS), ...Object.keys(FAILURE_REASONS)] as [string, ...string[]];

function revalidateOrders(orderId?: string) {
  revalidatePath("/dashboard/pedidos");
  revalidatePath("/dashboard/logistica");
  revalidatePath("/dashboard");
  if (orderId) revalidatePath(`/dashboard/pedidos/${orderId}`);
}

export async function changeOrderStatus(orderId: string, to: string, note?: string, reason?: string): Promise<ActionResult> {
  await requireStore();
  const parsed = z
    .object({ orderId: z.uuid(), to: z.enum(ORDER_STATUSES), note: z.string().max(500).optional(), reason: z.enum(REASONS).optional() })
    .safeParse({ orderId, to, note, reason });
  if (!parsed.success) return { ok: false, error: "Datos inválidos" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("change_order_status", {
    p_order_id: parsed.data.orderId,
    p_to: parsed.data.to,
    p_note: parsed.data.note ?? null,
    ...(parsed.data.reason ? { p_reason: parsed.data.reason } : {}),
  });
  if (error) {
    if (error.code === "P0001") return { ok: false, error: "Ese cambio de estado no está permitido" };
    return { ok: false, error: "No se pudo cambiar el estado" };
  }
  schedulePurchase([parsed.data.orderId]);
  revalidateOrders(orderId);
  return { ok: true, message: "Estado actualizado" };
}

/** Si el pedido llegó a la venta real, envía Purchase a Meta (una sola vez, en segundo plano). */
function schedulePurchase(orderIds: string[]) {
  after(async () => {
    const admin = createAdminClient();
    for (const id of orderIds) {
      try {
        await maybeSendPurchase(admin, id);
      } catch (e) {
        console.error("CAPI Purchase", e);
      }
    }
  });
}

export async function changeOrdersStatus(orderIds: string[], to: string, reason?: string): Promise<ActionResult> {
  await requireStore();
  const parsed = z
    .object({ ids: z.array(z.uuid()).min(1).max(200), to: z.enum(ORDER_STATUSES), reason: z.enum(REASONS).optional() })
    .safeParse({ ids: orderIds, to, reason });
  if (!parsed.success) return { ok: false, error: "Selección inválida" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("change_orders_status", {
    p_order_ids: parsed.data.ids,
    p_to: parsed.data.to,
    p_note: null,
    ...(parsed.data.reason ? { p_reason: parsed.data.reason } : {}),
  });
  if (error) return { ok: false, error: "No se pudieron actualizar los pedidos" };
  const result = data as { updated: number; failed: number };
  schedulePurchase(parsed.data.ids);
  revalidateOrders();
  return result.failed
    ? { ok: true, message: `${result.updated} actualizados · ${result.failed} no permitían ese cambio` }
    : { ok: true, message: `${result.updated} pedidos actualizados` };
}

const editSchema = z.object({
  shipping_cost: z.coerce.number().min(0, "El costo de envío no puede ser negativo").max(100_000),
  internal_notes: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .transform((v) => (v ? v : null)),
  address: z.string().trim().min(3, "Ingresa la dirección").max(300),
  reference: z
    .string()
    .trim()
    .max(300)
    .optional()
    .transform((v) => (v ? v : null)),
  courier_name: z
    .string()
    .trim()
    .max(80)
    .optional()
    .transform((v) => (v ? v : null)),
  tracking_code: z
    .string()
    .trim()
    .max(120)
    .optional()
    .transform((v) => (v ? v : null)),
});

export async function updateOrderDetails(orderId: string, _prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  const { store } = await requireStore();
  const parsed = editSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const { error } = await supabase.from("orders").update(parsed.data).eq("id", orderId).eq("store_id", store.id);
  if (error) return { ok: false, error: "No se pudo guardar" };
  revalidatePath(`/dashboard/pedidos/${orderId}`);
  return { ok: true, message: "Pedido actualizado" };
}

// ─────────────────────────────────────────────────────────────────────
// Controlador de pedidos
// ─────────────────────────────────────────────────────────────────────

const contactSchema = z.object({
  orderId: z.uuid(),
  channel: z.enum(["call", "whatsapp"]),
  result: z.enum(Object.keys(CONTACT_RESULTS) as [string, ...string[]]),
  note: z.string().trim().max(500).optional(),
  nextContactAt: z.iso.datetime({ offset: true }).optional(),
  cancelReason: z.enum(Object.keys(CANCEL_REASONS) as [string, ...string[]]).optional(),
});

export type ContactAttemptResult =
  | { ok: true; message: string; status: string; sequenceDone: boolean; nextChannel: string | null }
  | { ok: false; error: string };

/** Registra un intento de contacto (llamada o WhatsApp) y su resultado. */
export async function logContactAttempt(input: z.input<typeof contactSchema>): Promise<ContactAttemptResult> {
  await requireStore();
  const parsed = contactSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  const d = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("log_contact_attempt", {
    p_order_id: d.orderId,
    p_channel: d.channel,
    p_result: d.result,
    p_note: d.note ?? null,
    p_next_contact_at: d.nextContactAt ?? null,
    p_cancel_reason: d.cancelReason ?? null,
  });
  if (error) return { ok: false, error: error.code === "P0001" || error.code === "P0002" ? error.message : "No se pudo registrar el intento" };
  const r = data as { attempt: number; status: string; sequence_done: boolean; next_channel: string | null };
  revalidateOrders(d.orderId);
  const label = CONTACT_RESULTS[d.result as keyof typeof CONTACT_RESULTS].label;
  const closing = d.result === "confirmed" || d.result === "rejected";
  return {
    ok: true,
    message: r.sequence_done && !closing ? `${label} · secuencia completa` : `Intento ${r.attempt}: ${label}`,
    status: r.status,
    sequenceDone: r.sequence_done,
    nextChannel: r.next_channel,
  };
}

/** Asigna pedidos a una persona del equipo (null = quitar asignación). */
export async function assignOrders(orderIds: string[], userId: string | null): Promise<ActionResult> {
  await requireStore();
  const parsed = z.object({ ids: z.array(z.uuid()).min(1).max(200), userId: z.uuid().nullable() }).safeParse({ ids: orderIds, userId });
  if (!parsed.success) return { ok: false, error: "Datos inválidos" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("assign_orders", { p_order_ids: parsed.data.ids, p_user_id: parsed.data.userId });
  if (error) return { ok: false, error: error.code === "P0001" ? error.message : "No se pudo asignar" };
  revalidateOrders(orderIds.length === 1 ? orderIds[0] : undefined);
  return { ok: true, message: userId ? `${data} pedido(s) asignado(s)` : "Asignación quitada" };
}

const optionalNumber = (max: number) => z.union([z.literal(""), z.coerce.number().min(0).max(max)]).optional();

const manualSchema = orderInput
  .pick({ first_name: true, last_name: true, phone: true, dni: true, district_code: true, address: true, reference: true })
  .extend({
    idempotency_key: z.string().min(8).max(100),
    product_id: z.uuid("Elige un producto"),
    offer_id: z.union([z.literal(""), z.uuid()]).optional(),
    quantity: z.coerce.number().int().min(1).max(100).optional(),
    subtotal: optionalNumber(100_000),
    shipping: optionalNumber(10_000),
    advance: optionalNumber(100_000),
    source_channel: z.enum(["whatsapp", "instagram", "facebook", "tiktok", "llamada", "tienda", "otro"]),
    notes: z.string().trim().max(500).optional(),
    internal_notes: z.string().trim().max(1000).optional(),
    already_confirmed: z.boolean().optional(),
  });

export type ManualOrderInput = z.input<typeof manualSchema>;
export type ManualOrderResult = { ok: true; orderId: string; orderNumber: number } | { ok: false; error: string };

const blankToNull = (v: number | "" | undefined) => (v === "" || v === undefined ? null : v);

/** Registra a mano un pedido que llegó por WhatsApp, Instagram, llamada, etc. */
export async function createManualOrder(input: ManualOrderInput): Promise<ManualOrderResult> {
  const { store } = await requireStore();
  const parsed = manualSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  const d = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_manual_order", {
    p: {
      ...d,
      store_id: store.id,
      offer_id: d.offer_id || null,
      subtotal: blankToNull(d.subtotal),
      shipping: blankToNull(d.shipping),
      advance: blankToNull(d.advance),
    },
  });
  if (error) return { ok: false, error: error.code === "P0001" || error.code === "P0002" ? error.message : "No se pudo registrar el pedido" };
  const r = data as { order_id: string; order_number: number };
  revalidateOrders();
  return { ok: true, orderId: r.order_id, orderNumber: r.order_number };
}
