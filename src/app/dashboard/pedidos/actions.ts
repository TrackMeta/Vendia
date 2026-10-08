"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { requireStore } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { COURIER_IDS, courierName, PACKAGE_SIZES, SHALOM_DESTINATIONS } from "@/modules/couriers";
import { maybeSendPurchase } from "@/modules/meta/capi";
import { CANCEL_REASONS, CONTACT_RESULTS, FAILURE_REASONS } from "@/modules/orders/contact";
import { orderInput } from "@/modules/orders/order-input";
import { PAYMENT_METHODS, RECEIPTS_BUCKET } from "@/modules/orders/payments";
import { ORDER_STATUSES } from "@/modules/orders/state-machine";

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

const REASONS = [...Object.keys(CANCEL_REASONS), ...Object.keys(FAILURE_REASONS)] as [string, ...string[]];

/** Mensaje legible de un error de la base de datos al cambiar de estado. */
function statusError(error: { code?: string; message: string }, fallback = "No se pudo cambiar el estado") {
  if (error.code === "P0001") return error.message.startsWith("No se puede pasar") ? "Ese cambio de estado no está permitido" : error.message;
  if (error.code === "P0002") return error.message;
  return fallback;
}

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
  if (error) return { ok: false, error: statusError(error) };
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
  if (error) return { ok: false, error: statusError(error, "No se pudo registrar el intento") };
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

// ─────────────────────────────────────────────────────────────────────
// Envío (courier, agencia, clave de recojo, medidas) y pagos con comprobante
// ─────────────────────────────────────────────────────────────────────

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v ? v : null));

const shippingSchema = z
  .object({
    courier_id: z.union([z.literal(""), z.enum(COURIER_IDS as [string, ...string[]])]).transform((v) => v || null),
    tracking_code: text(120),
    courier_order_number: text(60),
    agency_destination: z
      .string()
      .trim()
      .max(120)
      .refine((v) => !v || SHALOM_DESTINATIONS.includes(v), "Elige una agencia de la lista oficial")
      .transform((v) => v || null),
    pickup_key: text(40),
    package_size: z.union([z.literal(""), z.enum(PACKAGE_SIZES as [string, ...string[]])]).transform((v) => v || null),
    package_weight: z.union([z.literal(""), z.coerce.number().min(0).max(1000)]).transform((v) => (v === "" ? null : v)),
    shipping_cost: z.coerce.number().min(0, "El costo de envío no puede ser negativo").max(100_000),
    return_shipments: z.union([z.literal(""), z.coerce.number().int().min(0).max(2)]).transform((v) => (v === "" ? null : v)),
    dni: z
      .string()
      .trim()
      .refine((v) => !v || /^\d{8}$/.test(v), "El DNI debe tener 8 dígitos")
      .transform((v) => v || null),
  })
  .partial();

export type ShippingInput = z.input<typeof shippingSchema>;

/** Guarda los datos de envío del pedido (solo los campos enviados). */
export async function updateOrderShipping(orderId: string, input: ShippingInput): Promise<ActionResult> {
  const { store } = await requireStore();
  const id = z.uuid().safeParse(orderId);
  const parsed = shippingSchema.safeParse(input);
  if (!id.success) return { ok: false, error: "Datos inválidos" };
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  const values: Record<string, unknown> = Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined));
  if ("courier_id" in values) values.courier_name = values.courier_id ? courierName(values.courier_id as string) : null;
  if (!Object.keys(values).length) return { ok: true, message: "Sin cambios" };

  const supabase = await createClient();
  const { error } = await supabase.from("orders").update(values).eq("id", id.data).eq("store_id", store.id);
  if (error) return { ok: false, error: "No se pudieron guardar los datos de envío" };
  revalidateOrders(id.data);
  return { ok: true, message: "Datos de envío guardados" };
}

const paymentSchema = z.object({
  orderId: z.uuid(),
  kind: z.enum(["advance", "balance"]),
  amount: z.coerce.number().positive("Ingresa el monto").max(100_000),
  method: z.enum(Object.keys(PAYMENT_METHODS) as [string, ...string[]]),
  paid_on: z.iso.date("Fecha inválida"),
  note: z.string().trim().max(300).optional(),
  receipt_path: z.string().max(300).optional(),
});

export type PaymentInput = z.input<typeof paymentSchema>;

/** Registra un adelanto o pago del saldo (el comprobante ya se subió al bucket privado). */
export async function addOrderPayment(input: PaymentInput): Promise<ActionResult> {
  const { store } = await requireStore();
  const parsed = paymentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  const d = parsed.data;
  if (d.receipt_path && !d.receipt_path.startsWith(`${store.id}/${d.orderId}/`)) return { ok: false, error: "Comprobante inválido" };

  const supabase = await createClient();
  const { error } = await supabase.from("order_payments").insert({
    store_id: store.id,
    order_id: d.orderId,
    kind: d.kind,
    amount: d.amount,
    method: d.method,
    paid_on: d.paid_on,
    note: d.note || null,
    receipt_path: d.receipt_path || null,
  });
  if (error) return { ok: false, error: "No se pudo registrar el pago" };
  revalidateOrders(d.orderId);
  return { ok: true, message: d.kind === "advance" ? "Adelanto registrado" : "Pago del saldo registrado" };
}

export async function verifyOrderPayment(paymentId: string, orderId: string): Promise<ActionResult> {
  await requireStore();
  if (!z.uuid().safeParse(paymentId).success) return { ok: false, error: "Datos inválidos" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("verify_order_payment", { p_payment_id: paymentId });
  if (error) return { ok: false, error: "No se pudo verificar" };
  revalidateOrders(orderId);
  return { ok: true, message: "Pago verificado" };
}

export async function deleteOrderPayment(paymentId: string, orderId: string): Promise<ActionResult> {
  const { store } = await requireStore();
  if (!z.uuid().safeParse(paymentId).success) return { ok: false, error: "Datos inválidos" };
  const supabase = await createClient();
  const { data, error } = await supabase.from("order_payments").delete().eq("id", paymentId).eq("store_id", store.id).select("receipt_path");
  if (error || !data?.length) return { ok: false, error: "No se pudo eliminar (un pago verificado solo lo elimina el dueño)" };
  const path = data[0].receipt_path as string | null;
  if (path) await supabase.storage.from(RECEIPTS_BUCKET).remove([path]);
  revalidateOrders(orderId);
  return { ok: true, message: "Pago eliminado" };
}
