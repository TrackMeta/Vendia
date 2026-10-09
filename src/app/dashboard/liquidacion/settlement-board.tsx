"use client";

import { CheckCircle2, Undo2 } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { courierName } from "@/modules/couriers";
import { settleOrders, undoSettlement } from "./actions";
import { CourierIcon } from "@/components/brand-icons";

export type PendingOrder = {
  id: string;
  order_number: number;
  customer_name: string;
  courier_id: string | null;
  balance_due: number;
  shipping_cost: number;
  delivered_at: string;
  days: number;
};

export type SettlementRow = { id: string; courier_id: string | null; order_count: number; gross: number; shipping: number; net: number; note: string | null; created_at: string };

const tone = (days: number) => (days >= 3 ? "text-red-600" : days >= 1 ? "text-amber-600" : "text-emerald-600");

/** Pendientes por courier (lo cobrado − su envío) + historial de liquidaciones. */
export function SettlementBoard({ pending, history }: { pending: PendingOrder[]; history: SettlementRow[] }) {
  const [pendingTx, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const groups = new Map<string, PendingOrder[]>();
  for (const o of pending) {
    const key = o.courier_id ?? "";
    groups.set(key, [...(groups.get(key) ?? []), o]);
  }

  const settle = (ids: string[], label: string, net: number) => {
    if (!confirm(`¿${label} te depositó ${formatMoney(net)} por ${ids.length} pedido(s)? Pasarán a «Cobrado».`)) return;
    startTransition(async () => {
      const r = await settleOrders(ids, `Depósito de ${label}`);
      if (r.ok) {
        toast.success(r.message ?? "Liquidado");
        setSelected(new Set());
      } else toast.error(r.error);
    });
  };

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="flex flex-col gap-4">
      {!pending.length ? (
        <Card>
          <CardContent className="flex items-center gap-2 py-6 text-sm">
            <CheckCircle2 className="size-5 text-emerald-600" /> Ningún courier te debe: todo lo entregado en Lima ya está liquidado.
          </CardContent>
        </Card>
      ) : null}

      {[...groups.entries()].map(([courierId, orders]) => {
        const label = courierId ? courierName(courierId) : "Sin courier";
        const gross = orders.reduce((s, o) => s + o.balance_due, 0);
        const shipping = orders.reduce((s, o) => s + o.shipping_cost, 0);
        const oldest = Math.max(...orders.map((o) => o.days));
        const chosen = orders.filter((o) => selected.has(o.id));
        const chosenNet = chosen.reduce((s, o) => s + o.balance_due - o.shipping_cost, 0);
        return (
          <Card key={courierId || "none"}>
            <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
              <div className="flex flex-col gap-1">
                <CardTitle className="flex items-center gap-2">
                  <CourierIcon id={courierId} className="size-6" /> {label}
                </CardTitle>
                <CardDescription>
                  Cobró {formatMoney(gross)} − envíos {formatMoney(shipping)} · {orders.length} entrega(s) ·{" "}
                  <span className={tone(oldest)}>{oldest > 0 ? `la más antigua hace ${oldest} día(s)` : "al día"}</span>
                </CardDescription>
              </div>
              <div className="flex flex-col items-end gap-2">
                <span className="text-2xl font-semibold tabular-nums">{formatMoney(gross - shipping)}</span>
                <div className="flex gap-2">
                  {chosen.length ? (
                    <Button size="sm" variant="outline" disabled={pendingTx} onClick={() => settle(chosen.map((o) => o.id), label, chosenNet)}>
                      Liquidar {chosen.length} · {formatMoney(chosenNet)}
                    </Button>
                  ) : null}
                  <Button size="sm" disabled={pendingTx} onClick={() => settle(orders.map((o) => o.id), label, gross - shipping)}>
                    Liquidar todo
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-col divide-y text-sm">
                {orders.map((o) => (
                  <li key={o.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                    <input type="checkbox" checked={selected.has(o.id)} onChange={() => toggle(o.id)} className="size-4" aria-label={`Elegir pedido ${o.order_number}`} />
                    <Link href={`/dashboard/pedidos/${o.id}`} className="font-medium hover:underline">
                      #{o.order_number}
                    </Link>
                    <span className="text-muted-foreground">{o.customer_name}</span>
                    <span className={`text-xs ${tone(o.days)}`}>entregado {formatDateTime(o.delivered_at)}</span>
                    <span className="ml-auto text-right tabular-nums">
                      {formatMoney(o.balance_due - o.shipping_cost)}
                      <span className="block text-xs text-muted-foreground">
                        {formatMoney(o.balance_due)} − {formatMoney(o.shipping_cost)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        );
      })}

      <Card>
        <CardHeader>
          <CardTitle>Historial de liquidaciones</CardTitle>
          <CardDescription>Lo que te depositó cada courier. Si marcaste algo por error, anúlalo: esos pedidos vuelven a «Entregado».</CardDescription>
        </CardHeader>
        <CardContent>
          {history.length ? (
            <ul className="flex flex-col divide-y text-sm">
              {history.map((h) => (
                <li key={h.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                  <span className="flex items-center gap-1.5 font-medium">
                    <CourierIcon id={h.courier_id} className="size-4" />
                    {h.courier_id === "varios" ? "Varios couriers" : courierName(h.courier_id)}
                  </span>
                  <span className="text-muted-foreground">
                    {formatDate(h.created_at)} · {h.order_count} pedido(s) · cobró {formatMoney(h.gross)} − envíos {formatMoney(h.shipping)}
                  </span>
                  <span className="ml-auto font-semibold tabular-nums">{formatMoney(h.net)}</span>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    disabled={pendingTx}
                    aria-label="Anular liquidación"
                    onClick={() => {
                      if (!confirm("¿Anular esta liquidación? Sus pedidos vuelven a «Entregado» (pendientes de liquidar).")) return;
                      startTransition(async () => {
                        const r = await undoSettlement(h.id);
                        if (r.ok) toast.success(r.message ?? "Anulada");
                        else toast.error(r.error);
                      });
                    }}
                  >
                    <Undo2 />
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">Aún no has liquidado.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
