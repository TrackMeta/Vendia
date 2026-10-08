"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { requireStore } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { maybeSendPurchase } from "@/modules/meta/capi";
import { ORDER_STATUSES } from "@/modules/orders/state-machine";

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

export async function changeOrderStatus(orderId: string, to: string, note?: string): Promise<ActionResult> {
  await requireStore();
  const parsed = z
    .object({ orderId: z.uuid(), to: z.enum(ORDER_STATUSES), note: z.string().max(500).optional() })
    .safeParse({ orderId, to, note });
  if (!parsed.success) return { ok: false, error: "Datos inválidos" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("change_order_status", {
    p_order_id: parsed.data.orderId,
    p_to: parsed.data.to,
    p_note: parsed.data.note ?? null,
  });
  if (error) {
    if (error.code === "P0001") return { ok: false, error: "Ese cambio de estado no está permitido" };
    return { ok: false, error: "No se pudo cambiar el estado" };
  }
  schedulePurchase([parsed.data.orderId]);
  revalidatePath("/dashboard/pedidos");
  revalidatePath(`/dashboard/pedidos/${orderId}`);
  revalidatePath("/dashboard");
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

export async function changeOrdersStatus(orderIds: string[], to: string): Promise<ActionResult> {
  await requireStore();
  const parsed = z.object({ ids: z.array(z.uuid()).min(1).max(200), to: z.enum(ORDER_STATUSES) }).safeParse({ ids: orderIds, to });
  if (!parsed.success) return { ok: false, error: "Selección inválida" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("change_orders_status", { p_order_ids: parsed.data.ids, p_to: parsed.data.to, p_note: null });
  if (error) return { ok: false, error: "No se pudieron actualizar los pedidos" };
  const result = data as { updated: number; failed: number };
  schedulePurchase(parsed.data.ids);
  revalidatePath("/dashboard/pedidos");
  revalidatePath("/dashboard");
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
