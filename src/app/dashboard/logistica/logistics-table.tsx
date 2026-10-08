"use client";

import { AlertTriangle, Check, Download, MessageCircle, X } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { OrderStatusBadge } from "@/components/dashboard/status-badge";
import { Button } from "@/components/ui/button";
import { displayPeruPhone, formatDateTime, formatMoney } from "@/lib/format";
import type { OrderStatus } from "@/modules/orders/state-machine";
import { changeOrdersStatus, changeOrderStatus } from "../pedidos/actions";

export type LogisticsOrder = {
  id: string;
  order_number: number;
  created_at: string;
  status: OrderStatus;
  customer_name: string;
  customer_phone: string;
  total: number;
  balance_due: number;
  address: string;
  reference: string | null;
  district_name: string;
  province_name: string;
  department_name: string;
  is_possible_duplicate: boolean;
  courier_name: string | null;
  tracking_code: string | null;
  order_items: { product_name: string; offer_name: string | null; quantity: number }[];
};

const BULK_ACTIONS: Record<string, { to: OrderStatus; label: string; destructive?: boolean }[]> = {
  confirmar: [
    { to: "confirmed", label: "Confirmar" },
    { to: "cancelled", label: "Cancelar", destructive: true },
  ],
  despachar: [
    { to: "preparing", label: "Marcar Preparando" },
    { to: "shipped", label: "Marcar Enviado" },
  ],
  "en-camino": [
    { to: "out_for_delivery", label: "En reparto" },
    { to: "delivered", label: "Entregado" },
    { to: "failed_delivery", label: "No entregado", destructive: true },
  ],
};

function whatsappLink(o: LogisticsOrder, storeName: string) {
  const item = o.order_items[0];
  const text = `Hola ${o.customer_name.split(" ")[0]}, te saludamos de ${storeName}. Recibimos tu pedido #${o.order_number} de ${item?.product_name ?? ""}${
    item?.offer_name ? ` (${item.offer_name})` : ""
  } por ${formatMoney(o.total)}, con entrega en ${o.address}, ${o.district_name}. ¿Nos confirmas tu pedido?`;
  return `https://wa.me/${o.customer_phone}?text=${encodeURIComponent(text)}`;
}

export function LogisticsTable({ view, orders, storeName }: { view: string; orders: LogisticsOrder[]; storeName: string }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();
  const allSelected = orders.length > 0 && selected.size === orders.length;

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const bulk = (to: OrderStatus, ids: string[]) =>
    startTransition(async () => {
      const r = ids.length === 1 ? await changeOrderStatus(ids[0], to) : await changeOrdersStatus(ids, to);
      if (r.ok) toast.success(r.message ?? "Actualizado");
      else toast.error(r.error);
      setSelected(new Set());
    });

  if (!orders.length) {
    return <p className="rounded-xl border border-dashed px-6 py-12 text-center text-sm text-muted-foreground">No hay pedidos en esta bandeja. 🎉</p>;
  }

  const selectedIds = [...selected];

  return (
    <div className="flex flex-col gap-3">
      <div className="sticky top-14 z-10 flex flex-wrap items-center gap-2 rounded-lg border bg-background/95 p-2 backdrop-blur md:top-0">
        <label className="flex items-center gap-2 px-1 text-sm">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={() => setSelected(allSelected ? new Set() : new Set(orders.map((o) => o.id)))}
            className="size-4"
          />
          {selected.size ? `${selected.size} seleccionados` : "Seleccionar todos"}
        </label>
        <div className="ml-auto flex flex-wrap gap-2">
          {BULK_ACTIONS[view].map((a) => (
            <Button
              key={a.to}
              size="sm"
              variant={a.destructive ? "destructive" : "outline"}
              disabled={!selected.size || pending}
              onClick={() => {
                if (a.destructive && !confirm(`¿${a.label} ${selected.size} pedidos?`)) return;
                bulk(a.to, selectedIds);
              }}
            >
              {a.label}
            </Button>
          ))}
          {view === "despachar" ? (
            <form method="post" action="/dashboard/logistica/exportar">
              {(selected.size ? selectedIds : orders.map((o) => o.id)).map((id) => (
                <input key={id} type="hidden" name="ids" value={id} />
              ))}
              <Button size="sm" type="submit">
                <Download /> Excel para courier {selected.size ? `(${selected.size})` : "(todos)"}
              </Button>
            </form>
          ) : null}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        {orders.map((o) => {
          const item = o.order_items[0];
          return (
            <div key={o.id} className="flex gap-3 rounded-xl border p-3">
              <input type="checkbox" checked={selected.has(o.id)} onChange={() => toggle(o.id)} className="mt-1 size-4 shrink-0" aria-label={`Seleccionar pedido ${o.order_number}`} />
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/dashboard/pedidos/${o.id}`} className="font-semibold hover:underline">
                    #{o.order_number}
                  </Link>
                  <OrderStatusBadge status={o.status} />
                  {o.is_possible_duplicate ? (
                    <span className="flex items-center gap-1 text-xs text-amber-600">
                      <AlertTriangle className="size-3.5" /> Posible duplicado
                    </span>
                  ) : null}
                  <span className="text-xs text-muted-foreground">{formatDateTime(o.created_at)}</span>
                  <span className="ml-auto font-semibold tabular-nums">{formatMoney(o.balance_due)}</span>
                </div>
                <p className="text-sm">
                  <span className="font-medium">{o.customer_name}</span> · {displayPeruPhone(o.customer_phone)}
                </p>
                <p className="text-sm text-muted-foreground">
                  {item?.product_name}
                  {item?.offer_name ? ` · ${item.offer_name}` : ""} · {o.address}
                  {o.reference ? ` (Ref: ${o.reference})` : ""} · {o.district_name}, {o.province_name}, {o.department_name}
                </p>
                {o.tracking_code || o.courier_name ? (
                  <p className="text-xs text-muted-foreground">
                    {o.courier_name ?? "Courier"} {o.tracking_code ? `· Guía ${o.tracking_code}` : ""}
                  </p>
                ) : null}
                {view === "confirmar" ? (
                  <div className="mt-1 flex flex-wrap gap-2">
                    <a
                      href={whatsappLink(o, storeName)}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => {
                        if (o.status === "new") bulk("pending_confirmation", [o.id]);
                      }}
                      className="flex items-center gap-1.5 rounded-lg bg-[#25D366] px-3 py-1.5 text-sm font-semibold text-white"
                    >
                      <MessageCircle className="size-4" /> WhatsApp
                    </a>
                    <Button size="sm" disabled={pending} onClick={() => bulk("confirmed", [o.id])}>
                      <Check /> Confirmar
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pending}
                      onClick={() => {
                        if (confirm(`¿Cancelar el pedido #${o.order_number}?`)) bulk("cancelled", [o.id]);
                      }}
                    >
                      <X /> Cancelar
                    </Button>
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
