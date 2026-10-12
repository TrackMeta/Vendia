import type { Metadata } from "next";
import { PageHeader } from "@/components/dashboard/page-header";
import { requireOwner } from "@/lib/auth";
import { formatMoney } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { type PendingOrder, SettlementBoard, type SettlementRow } from "./settlement-board";

export const metadata: Metadata = { title: "Liquidación" };

const DAY = 86_400_000;

/** Días desde una fecha (en el servidor, al momento de pedir la página). */
function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / DAY);
}

/**
 * Liquidación con los couriers de Lima: el motorizado cobra en la puerta y luego te deposita
 * lo cobrado menos su envío. Aquí ves cuánto te debe cada uno y desde cuándo.
 */
export default async function SettlementPage() {
  const { store } = await requireOwner();
  const supabase = await createClient();
  const [{ data: pending }, { data: history }, { data: atAgency }, { data: failed }] = await Promise.all([
    supabase
      .from("orders")
      .select("id, order_number, customer_name, courier_id, balance_due, shipping_cost, delivered_at")
      .eq("store_id", store.id)
      .eq("zone", "lima")
      .eq("status", "delivered")
      .is("settled_at", null)
      .order("delivered_at", { ascending: true })
      .limit(1000),
    supabase.from("courier_settlements").select("id, courier_id, order_count, gross, shipping, net, note, created_at").eq("store_id", store.id).order("created_at", { ascending: false }).limit(30),
    supabase.from("orders").select("balance_due").eq("store_id", store.id).eq("zone", "provincia").eq("status", "at_agency").limit(1000),
    // Envíos fallidos de Lima: el courier igual cobra su envío (y la devolución) y lo descuenta del depósito
    supabase
      .from("orders")
      .select("id, order_number, customer_name, courier_id, shipping_cost, return_shipments, status, updated_at")
      .eq("store_id", store.id)
      .eq("zone", "lima")
      .in("status", ["failed_delivery", "returned"])
      .not("shipped_at", "is", null)
      .is("settled_at", null)
      .order("updated_at", { ascending: true })
      .limit(1000),
  ]);

  const rows: PendingOrder[] = (pending ?? []).map((o) => ({
    id: o.id,
    order_number: o.order_number,
    customer_name: o.customer_name,
    courier_id: o.courier_id,
    balance_due: Number(o.balance_due),
    shipping_cost: Number(o.shipping_cost),
    delivered_at: o.delivered_at!,
    days: daysSince(o.delivered_at!),
    failed: false,
  }));
  for (const o of failed ?? []) {
    rows.push({
      id: o.id,
      order_number: o.order_number,
      customer_name: o.customer_name,
      courier_id: o.courier_id,
      // No cobró nada; te descuenta su envío por cada intento (como en order_logistics_cost)
      balance_due: 0,
      shipping_cost: Number(o.shipping_cost) * (o.return_shipments ?? 1),
      delivered_at: o.updated_at,
      days: daysSince(o.updated_at),
      failed: true,
    });
  }
  const limaNet = rows.reduce((s, o) => s + o.balance_due - o.shipping_cost, 0);
  const provinceDue = (atAgency ?? []).reduce((s, o) => s + Number(o.balance_due), 0);

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader title="Liquidación" description="Cuánto te debe cada courier de Lima (lo que cobró menos sus envíos, también los fallidos) y desde cuándo. Al liquidar, los entregados pasan a «Cobrado»." />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="dark rounded-xl bg-[#202124] p-4 text-white">
          <p className="text-xs text-muted-foreground">Lima: por recibir de los couriers</p>
          <p className="text-2xl font-semibold tabular-nums">{formatMoney(limaNet)}</p>
          <p className="text-xs text-muted-foreground">
            {rows.filter((r) => !r.failed).length} entrega(s) sin liquidar
            {rows.some((r) => r.failed) ? ` · ${rows.filter((r) => r.failed).length} envío(s) fallido(s)` : ""}
          </p>
        </div>
        <div className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
          <p className="text-xs text-muted-foreground">Provincia: saldo por cobrar en agencia</p>
          <p className="text-2xl font-semibold tabular-nums">{formatMoney(provinceDue)}</p>
          <p className="text-xs text-muted-foreground">{atAgency?.length ?? 0} pedido(s) esperando que el cliente pague y recoja</p>
        </div>
      </div>
      <SettlementBoard
        pending={rows}
        history={((history ?? []) as SettlementRow[]).map((h) => ({ ...h, gross: Number(h.gross), shipping: Number(h.shipping), net: Number(h.net) }))}
      />
    </div>
  );
}
