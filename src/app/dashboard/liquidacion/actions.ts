"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatMoney } from "@/lib/format";

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

function revalidate() {
  revalidatePath("/dashboard/liquidacion");
  revalidatePath("/dashboard/pedidos");
  revalidatePath("/dashboard");
}

/** Marca como liquidados (el courier ya te depositó) y pasan a «Cobrado». */
export async function settleOrders(orderIds: string[], note?: string): Promise<ActionResult> {
  const { store } = await requireOwner();
  const parsed = z.object({ ids: z.array(z.uuid()).min(1).max(1000), note: z.string().trim().max(300).optional() }).safeParse({ ids: orderIds, note });
  if (!parsed.success) return { ok: false, error: "Selecciona pedidos para liquidar" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("settle_orders", { p_store_id: store.id, p_order_ids: parsed.data.ids, p_note: parsed.data.note ?? null });
  if (error) return { ok: false, error: error.code === "P0001" ? error.message : "No se pudo liquidar" };
  const r = data as { orders: number; net: number };
  revalidate();
  return { ok: true, message: `${r.orders} pedido(s) liquidados · recibiste ${formatMoney(r.net)}` };
}

export async function undoSettlement(settlementId: string): Promise<ActionResult> {
  await requireOwner();
  if (!z.uuid().safeParse(settlementId).success) return { ok: false, error: "Liquidación inválida" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("undo_settlement", { p_settlement_id: settlementId });
  if (error) return { ok: false, error: "No se pudo anular" };
  revalidate();
  return { ok: true, message: `Liquidación anulada: ${data} pedido(s) volvieron a «Entregado»` };
}
