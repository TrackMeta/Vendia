"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOwner } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { enqueueOrderEvent, maybeSendPurchase, sendMarketingEvent } from "@/modules/meta/capi";

type Result = { ok: true; message: string } | { ok: false; error: string };

/**
 * «Reintentar» del pedido: vuelve a enviar a Meta (y TikTok) los eventos de este pedido que no llegaron,
 * y registra los que faltan (el pedido si vino de una landing; la venta si ya es venta real).
 */
export async function retryOrderEvents(orderId: string): Promise<Result> {
  const { store } = await requireOwner();
  if (!z.uuid().safeParse(orderId).success) return { ok: false, error: "Pedido inválido" };
  const admin = createAdminClient();
  const { data: order } = await admin.from("orders").select("id, source").eq("id", orderId).eq("store_id", store.id).maybeSingle();
  if (!order) return { ok: false, error: "Pedido no encontrado" };

  const { data: rows } = await admin.from("marketing_events").select("id, status, event_name, platform").eq("store_id", store.id).eq("order_id", orderId);
  const pending = (rows ?? []).filter((r) => r.status !== "sent");
  if (pending.length) {
    // Un reintento a mano empieza de cero (aunque haya agotado los intentos automáticos)
    await admin.from("marketing_events").update({ status: "pending", attempts: 0, last_error: null }).in("id", pending.map((r) => r.id));
    for (const r of pending) await sendMarketingEvent(admin, r.id);
  }
  const has = (name: string) => (rows ?? []).some((r) => r.platform === "meta" && r.event_name === name);
  if (!has("Lead") && order.source === "landing") await enqueueOrderEvent(admin, orderId, "Lead");
  if (!has("Purchase")) await maybeSendPurchase(admin, orderId);

  const { data: after } = await admin.from("marketing_events").select("status").eq("store_id", store.id).eq("order_id", orderId);
  revalidatePath(`/dashboard/pedidos/${orderId}`);
  const failed = (after ?? []).filter((r) => r.status === "failed" || r.status === "skipped").length;
  if (!(after ?? []).length) return { ok: false, error: "No hay nada que enviar: revisa que Meta esté conectado en Marketing" };
  return failed
    ? { ok: false, error: "Algunos eventos no se pudieron enviar. Mira el motivo debajo de cada uno." }
    : { ok: true, message: "Listo: Meta ya tiene los eventos de este pedido" };
}
