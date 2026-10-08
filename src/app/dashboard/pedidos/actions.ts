"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStore } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
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
  revalidatePath("/dashboard/pedidos");
  revalidatePath(`/dashboard/pedidos/${orderId}`);
  revalidatePath("/dashboard");
  return { ok: true, message: "Estado actualizado" };
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
