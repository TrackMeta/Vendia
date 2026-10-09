"use client";

import { AlertTriangle, Building2, Bus, Download, FileSpreadsheet, MapPin, Printer, UserCheck } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ContactPanel } from "@/components/dashboard/contact-panel";
import { OrderStatusBadge, SimpleBadge } from "@/components/dashboard/status-badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { displayPeruPhone, formatDateTime, formatMoney } from "@/lib/format";
import { CANCEL_REASONS, type ContactChannel, FAILURE_REASONS, RISK_LABELS } from "@/modules/orders/contact";
import { itemLabel, type VariantBreakdown } from "@/modules/orders/items";
import type { OrderStatus } from "@/modules/orders/state-machine";
import { assignOrders, changeOrdersStatus } from "../pedidos/actions";
import { ExportDialog, type StoreCourier } from "./export-dialog";

export type LogisticsOrder = {
  id: string;
  order_number: number;
  created_at: string;
  status: OrderStatus;
  zone: "lima" | "provincia";
  customer_name: string;
  customer_phone: string;
  dni: string | null;
  agency_destination: string | null;
  exported_at: string | null;
  total: number;
  balance_due: number;
  address: string;
  reference: string | null;
  district_name: string;
  province_name: string;
  department_name: string;
  is_possible_duplicate: boolean;
  risk_reasons: string[] | null;
  courier_name: string | null;
  tracking_code: string | null;
  assigned_to: string | null;
  contact_attempts: number;
  last_contact_result: string | null;
  last_contact_at: string | null;
  next_contact_at: string | null;
  contact_sequence_done: boolean;
  source: string;
  source_channel: string | null;
  order_items: {
    product_name: string;
    offer_name: string | null;
    quantity: number;
    variant_breakdown?: VariantBreakdown;
  }[];
};

type BulkAction = {
  to: OrderStatus;
  label: string;
  reasons?: Record<string, string>;
};

const BULK_ACTIONS: Record<string, BulkAction[]> = {
  confirmar: [
    { to: "confirmed", label: "Confirmar" },
    { to: "cancelled", label: "Cancelar", reasons: CANCEL_REASONS },
  ],
  despachar: [
    { to: "preparing", label: "Marcar Preparando" },
    { to: "shipped", label: "Marcar Enviado" },
    { to: "cancelled", label: "Cancelar", reasons: CANCEL_REASONS },
  ],
  "en-camino": [
    { to: "out_for_delivery", label: "En reparto (Lima)" },
    { to: "at_agency", label: "En agencia (provincia)" },
    { to: "collected", label: "Cobrado" },
    { to: "delivered", label: "Entregado" },
    { to: "failed_delivery", label: "No entregado", reasons: FAILURE_REASONS },
  ],
};

/** Mensaje de bandeja vacía: dice qué significa y qué viene después. */
const EMPTY_TEXT: Record<string, { title: string; text: string }> = {
  confirmar: { title: "Todo confirmado", text: "Cuando entre un pedido nuevo aparecerá aquí para llamar o escribir por WhatsApp al cliente." },
  despachar: { title: "Nada por despachar", text: "Los pedidos que confirmes pasan aquí para descargar la planilla del courier e imprimir rótulos." },
  "en-camino": { title: "Nada en camino", text: "Aquí verás los pedidos enviados hasta que se entreguen o lleguen a la agencia." },
};

/** Zona en gris con ícono: no compite con los colores de estado del pedido. */
export function ZoneBadge({ zone }: { zone: "lima" | "provincia" }) {
  const Icon = zone === "lima" ? Building2 : Bus;
  return (
    <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap text-muted-foreground">
      <Icon className="size-3" aria-hidden />
      {zone === "lima" ? "Lima" : "Provincia"}
    </span>
  );
}

export function LogisticsTable({
  view,
  orders,
  storeName,
  sequence,
  members,
  currentUserId,
  couriers,
}: {
  view: string;
  orders: LogisticsOrder[];
  storeName: string;
  sequence: ContactChannel[];
  members: { id: string; name: string; color?: string | null }[];
  currentUserId: string;
  couriers: StoreCourier[];
}) {
  const [exportOpen, setExportOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();
  const [reasonAction, setReasonAction] = useState<BulkAction | null>(null);
  const [reason, setReason] = useState("");
  const allSelected = orders.length > 0 && selected.size === orders.length;
  const memberName = (id: string | null) => (id ? (members.find((m) => m.id === id)?.name ?? "Equipo") : null);

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const bulk = (to: OrderStatus, ids: string[], withReason?: string) =>
    startTransition(async () => {
      const r = await changeOrdersStatus(ids, to, withReason);
      if (r.ok) toast.success(r.message ?? "Actualizado");
      else toast.error(r.error);
      setSelected(new Set());
      setReasonAction(null);
    });

  const assign = (userId: string | null) =>
    startTransition(async () => {
      const r = await assignOrders([...selected], userId);
      if (r.ok) toast.success(r.message ?? "Asignado");
      else toast.error(r.error);
      setSelected(new Set());
    });

  if (!orders.length) {
    return (
      <div className="flex flex-col items-center gap-1 rounded-xl border border-dashed px-6 py-12 text-center">
        <p className="font-medium">{EMPTY_TEXT[view]?.title ?? "No hay pedidos en esta bandeja"}</p>
        <p className="max-w-sm text-sm text-muted-foreground">{EMPTY_TEXT[view]?.text ?? "Prueba con otra zona o quita el filtro «Mis pendientes»."}</p>
      </div>
    );
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
          {selected.size ? `${selected.size} seleccionados` : `Seleccionar todos (${orders.length})`}
        </label>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {members.length > 1 ? (
            <select
              disabled={!selected.size || pending}
              value=""
              onChange={(e) => assign(e.target.value === "none" ? null : e.target.value)}
              className="h-7 rounded-md border bg-background px-2 text-sm disabled:opacity-50"
              aria-label="Asignar a"
            >
              <option value="" disabled>
                Asignar a…
              </option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.id === currentUserId ? `Mí (${m.name})` : m.name}
                </option>
              ))}
              <option value="none">Sin asignar</option>
            </select>
          ) : null}
          {BULK_ACTIONS[view].map((a) => (
            <Button
              key={a.to}
              size="sm"
              variant={a.reasons ? "destructive" : "outline"}
              disabled={!selected.size || pending}
              onClick={() => {
                if (a.reasons) {
                  setReason(Object.keys(a.reasons)[0]);
                  setReasonAction(a);
                } else bulk(a.to, selectedIds);
              }}
            >
              {a.label}
            </Button>
          ))}
          {view !== "confirmar" ? (
            <a
              href={`/rotulos?ids=${(selected.size ? selectedIds : orders.map((o) => o.id)).join(",")}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-7 items-center gap-1 rounded-md px-2.5 text-[0.8rem] font-medium hover:bg-muted"
            >
              <Printer className="size-3.5" /> Rótulos {selected.size ? `(${selected.size})` : ""}
            </a>
          ) : null}
          {view === "despachar" ? (
            <>
              <form method="post" action="/dashboard/logistica/exportar">
                {(selected.size ? selectedIds : orders.map((o) => o.id)).map((id) => (
                  <input key={id} type="hidden" name="ids" value={id} />
                ))}
                <Button size="sm" variant="ghost" type="submit" title="CSV genérico para otros couriers">
                  <Download /> CSV
                </Button>
              </form>
              <Button size="sm" disabled={!selected.size && !orders.some((o) => !o.exported_at)} onClick={() => setExportOpen(true)}>
                <FileSpreadsheet /> Exportar a courier {selected.size ? `(${selected.size})` : "(pendientes)"}
              </Button>
            </>
          ) : null}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        {orders.map((o) => {
          const item = o.order_items[0];
          const product = item ? itemLabel(item) : "";
          const risks = (o.risk_reasons ?? []).filter((r) => r !== "posible_duplicado");
          return (
            <div key={o.id} className="flex gap-3 rounded-xl bg-card p-3 ring-1 ring-foreground/10">
              <input
                type="checkbox"
                checked={selected.has(o.id)}
                onChange={() => toggle(o.id)}
                className="mt-1 size-4 shrink-0"
                aria-label={`Seleccionar pedido ${o.order_number}`}
              />
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/dashboard/pedidos/${o.id}`} className="font-semibold hover:underline">
                    #{o.order_number}
                  </Link>
                  <ZoneBadge zone={o.zone} />
                  <OrderStatusBadge status={o.status} />
                  {o.source === "manual" ? <SimpleBadge>Manual{o.source_channel ? ` · ${o.source_channel}` : ""}</SimpleBadge> : null}
                  {o.is_possible_duplicate ? (
                    <span className="flex items-center gap-1 text-xs text-amber-600">
                      <AlertTriangle className="size-3.5" /> Posible duplicado
                    </span>
                  ) : null}
                  {risks.map((r) => (
                    <span key={r} className="flex items-center gap-1 text-xs text-red-600">
                      <AlertTriangle className="size-3.5" /> {RISK_LABELS[r] ?? r}
                    </span>
                  ))}
                  {o.assigned_to ? (
                    <span
                      className="flex items-center gap-1 rounded-full px-1.5 text-xs font-medium"
                      style={{
                        color: members.find((m) => m.id === o.assigned_to)?.color ?? undefined,
                        backgroundColor: members.find((m) => m.id === o.assigned_to)?.color ? `${members.find((m) => m.id === o.assigned_to)?.color}1a` : undefined,
                      }}
                    >
                      <UserCheck className="size-3.5" /> {o.assigned_to === currentUserId ? "Tú" : memberName(o.assigned_to)}
                    </span>
                  ) : null}
                  <span className="text-xs text-muted-foreground">{formatDateTime(o.created_at)}</span>
                  <span className="ml-auto font-semibold tabular-nums">{formatMoney(view === "confirmar" ? o.total : o.balance_due)}</span>
                </div>
                <p className="text-sm">
                  <span className="font-medium">{o.customer_name}</span> · {displayPeruPhone(o.customer_phone)}
                </p>
                <p className="text-sm text-muted-foreground">
                  {product} · {o.address}
                  {o.reference ? ` (Ref: ${o.reference})` : ""} · {o.district_name}, {o.province_name}, {o.department_name}
                </p>
                {o.zone === "provincia" && view !== "confirmar" ? (
                  <p className={`flex items-center gap-1 text-xs ${o.agency_destination ? "text-muted-foreground" : "text-amber-600"}`}>
                    <MapPin className="size-3.5" /> {o.agency_destination ? `Agencia ${o.agency_destination}` : "Falta la agencia de destino"}
                    {!o.dni ? " · Falta DNI" : ""}
                  </p>
                ) : null}
                {o.exported_at && view === "despachar" ? <p className="text-xs text-muted-foreground">Ya exportado · {formatDateTime(o.exported_at)}</p> : null}
                {o.tracking_code || o.courier_name ? (
                  <p className="text-xs text-muted-foreground">
                    {o.courier_name ?? "Courier"} {o.tracking_code ? `· Guía ${o.tracking_code}` : ""}
                  </p>
                ) : null}
                {view === "confirmar" ? (
                  <div className="mt-1">
                    <ContactPanel
                      compact
                      storeName={storeName}
                      sequence={sequence}
                      order={{
                        id: o.id,
                        order_number: o.order_number,
                        customer_name: o.customer_name,
                        customer_phone: o.customer_phone,
                        total: o.total,
                        address: o.address,
                        district_name: o.district_name,
                        product_label: product,
                        contact_attempts: o.contact_attempts,
                        last_contact_result: o.last_contact_result,
                        next_contact_at: o.next_contact_at,
                        contact_sequence_done: o.contact_sequence_done,
                        zone: o.zone,
                        dni: o.dni,
                        agency_destination: o.agency_destination,
                        location_hint: o.district_name === o.province_name ? o.province_name : `${o.province_name} ${o.district_name}`,
                      }}
                    />
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      {exportOpen ? (
        <ExportDialog
          onClose={() => setExportOpen(false)}
          orderIds={selected.size ? selectedIds : orders.filter((o) => !o.exported_at).map((o) => o.id)}
          couriers={couriers}
          onDone={() => setSelected(new Set())}
        />
      ) : null}

      <Dialog open={reasonAction !== null} onOpenChange={(open) => !open && setReasonAction(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {reasonAction?.label} {selected.size} pedido(s)
            </DialogTitle>
            <DialogDescription>Elige el motivo. Sirve para analizar por qué se caen tus pedidos.</DialogDescription>
          </DialogHeader>
          <select value={reason} onChange={(e) => setReason(e.target.value)} className="h-9 rounded-md border bg-background px-2 text-sm">
            {Object.entries(reasonAction?.reasons ?? {}).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReasonAction(null)}>
              Volver
            </Button>
            <Button variant="destructive" disabled={pending} onClick={() => reasonAction && bulk(reasonAction.to, selectedIds, reason)}>
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
