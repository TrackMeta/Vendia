"use client";

import { AlertTriangle, Download, FileSpreadsheet, MapPin, Printer, UserCheck, X } from "lucide-react";
import dynamic from "next/dynamic";
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
import { courierName } from "@/modules/couriers";
import type { OrderStatus } from "@/modules/orders/state-machine";
import { assignOrders, changeOrdersStatus } from "../pedidos/actions";
import type { StoreCourier } from "./export-dialog";
import { ZoneBadge } from "./zone-badge";
import { AppSelect } from "@/components/dashboard/app-select";
import { SourceIcon } from "@/components/brand-icons";
import { cn } from "@/lib/utils";
import { SCROLL_ROW } from "../pedidos/orders-filters";
import { timeAgo } from "./time-ago";

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
  courier_id: string | null;
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
    { to: "collected", label: "Cobrado (provincia)" },
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

/**
 * Zona con color propio (Lima turquesa, provincia fucsia), con borde y sin relleno fuerte para no
 * confundirse con los colores de estado del pedido (ámbar, violeta, celeste, verde).
 */
// El exportador (plantillas y listas de los couriers) se baja recién al abrirlo
const ExportDialog = dynamic(() => import("./export-dialog").then((m) => m.ExportDialog), { ssr: false });

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
        <p className="max-w-sm text-sm text-muted-foreground">{EMPTY_TEXT[view]?.text ?? "Prueba con otra zona o quita el filtro «Solo míos»."}</p>
      </div>
    );
  }

  const selectedIds = [...selected];
  const any = selected.size > 0;
  const targetIds = any ? selectedIds : orders.map((o) => o.id);

  /**
   * Acciones masivas. «top»: la barra de arriba (en el celular solo muestra las que sirven sin
   * selección); «bottom»: la barra fija de abajo en el celular, con botones más altos para el dedo.
   */
  const actions = (where: "top" | "bottom") => {
    const bottom = where === "bottom";
    // En el celular, con algo seleccionado, todo se hace desde la barra de abajo
    const needsSelection = bottom ? "" : "max-md:hidden";
    const general = bottom ? "" : any ? "max-md:hidden" : "";
    const tall = bottom ? "h-9 px-3 text-sm" : undefined;
    return (
      <>
        {members.length > 1 ? (
          <div className={cn("shrink-0", needsSelection)}>
            <AppSelect
              disabled={!any || pending}
              value=""
              onChange={(e) => assign(e.target.value === "none" ? null : e.target.value)}
              className={bottom ? "h-9 rounded-md border bg-background px-2 text-sm" : "h-7 rounded-md border bg-background px-2 text-sm disabled:opacity-50"}
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
            </AppSelect>
          </div>
        ) : null}
        {BULK_ACTIONS[view].map((a) => (
          <Button
            key={a.to}
            size="sm"
            variant={a.reasons ? "destructive" : bottom && a.to === "confirmed" ? "default" : "outline"}
            disabled={!any || pending}
            className={cn(needsSelection, tall)}
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
            href={`/rotulos?ids=${targetIds.join(",")}`}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              "inline-flex shrink-0 items-center gap-1 rounded-md font-medium whitespace-nowrap hover:bg-muted",
              bottom ? "h-9 border px-3 text-sm" : "h-7 px-2.5 text-[0.8rem]",
              general,
            )}
          >
            <Printer className="size-3.5" /> Rótulos {any ? `(${selected.size})` : ""}
          </a>
        ) : null}
        {view === "despachar" ? (
          <>
            <form method="post" action="/dashboard/logistica/exportar" data-download="pedidos.csv" className={cn("shrink-0", general)}>
              {targetIds.map((id) => (
                <input key={id} type="hidden" name="ids" value={id} />
              ))}
              <Button size="sm" variant={bottom ? "outline" : "ghost"} type="submit" title="CSV genérico para otros couriers" className={tall}>
                <Download /> CSV
              </Button>
            </form>
            <Button size="sm" disabled={!any && !orders.some((o) => !o.exported_at)} onClick={() => setExportOpen(true)} className={cn(general, tall)}>
              <FileSpreadsheet /> Exportar a courier {any ? `(${selected.size})` : "(pendientes)"}
            </Button>
          </>
        ) : null}
      </>
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="z-10 flex flex-wrap items-center gap-2 rounded-lg border bg-background/95 p-2 backdrop-blur md:sticky md:top-0">
        <label className="flex min-h-8 cursor-pointer items-center gap-2 px-1 text-sm">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={() => setSelected(allSelected ? new Set() : new Set(orders.map((o) => o.id)))}
            className="size-5 accent-primary md:size-4"
          />
          {any ? `${selected.size} seleccionados` : `Seleccionar todos (${orders.length})`}
        </label>
        <div className="ml-auto flex flex-wrap items-center gap-2">{actions("top")}</div>
      </div>

      <div className="flex flex-col gap-2">
        {orders.map((o) => {
          const item = o.order_items[0];
          const product = item ? itemLabel(item) : "";
          const risks = (o.risk_reasons ?? []).filter((r) => r !== "posible_duplicado");
          const assignee = members.find((m) => m.id === o.assigned_to);
          const checked = selected.has(o.id);
          return (
            <div key={o.id} className={cn("flex flex-col gap-2 rounded-xl bg-card p-3 ring-1 ring-foreground/10 transition-shadow", checked && "ring-2 ring-primary/50")}>
              {/* Cabecera igual que en Pedidos: número + cliente, monto a la derecha, estado y zona */}
              <div className="flex gap-2">
                <label className="-mt-1.5 -ml-1.5 flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-md hover:bg-muted md:-mt-1 md:-ml-1 md:size-7">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(o.id)}
                    className="size-5 accent-primary md:size-4"
                    aria-label={`Seleccionar pedido ${o.order_number}`}
                  />
                </label>
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <div className="flex items-start justify-between gap-3">
                    <Link href={`/dashboard/pedidos/${o.id}`} className="flex min-w-0 items-baseline gap-1.5 hover:underline">
                      <span className="shrink-0 text-sm font-semibold tabular-nums">#{o.order_number}</span>
                      <span className="truncate font-medium">{o.customer_name}</span>
                    </Link>
                    <span className="shrink-0 font-semibold tabular-nums">{formatMoney(view === "confirmar" ? o.total : o.balance_due)}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <OrderStatusBadge status={o.status} />
                    <ZoneBadge zone={o.zone} />
                    {o.source === "manual" ? (
                      <span className="flex items-center gap-1">
                        <SourceIcon source={o.source_channel} />
                        <SimpleBadge>Manual{o.source_channel ? ` · ${o.source_channel}` : ""}</SimpleBadge>
                      </span>
                    ) : null}
                    {o.is_possible_duplicate ? (
                      <span className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                        <AlertTriangle className="size-3.5" /> Posible duplicado
                      </span>
                    ) : null}
                    {risks.map((r) => (
                      <span key={r} className="flex items-center gap-1 text-xs text-red-600 dark:text-red-400">
                        <AlertTriangle className="size-3.5" /> {RISK_LABELS[r] ?? r}
                      </span>
                    ))}
                    {o.assigned_to ? (
                      <span
                        className="flex items-center gap-1 rounded-full px-1.5 text-xs font-medium"
                        style={{
                          color: assignee?.color ?? undefined,
                          backgroundColor: assignee?.color ? `${assignee.color}1a` : undefined,
                        }}
                      >
                        <UserCheck className="size-3.5" /> {o.assigned_to === currentUserId ? "Tú" : memberName(o.assigned_to)}
                      </span>
                    ) : null}
                    <time dateTime={o.created_at} title={formatDateTime(o.created_at)} suppressHydrationWarning className="ml-auto text-xs text-muted-foreground">
                      {timeAgo(o.created_at)}
                    </time>
                  </div>
                </div>
              </div>
              <div className="flex flex-col gap-1.5 md:pl-9">
                <p className="text-sm">
                  <a href={`tel:+${o.customer_phone}`} className="font-medium tabular-nums hover:underline">
                    {displayPeruPhone(o.customer_phone)}
                  </a>
                  {product ? ` · ${product}` : ""}
                </p>
                <p className="text-sm text-muted-foreground">
                  {o.address}
                  {o.reference ? ` (Ref: ${o.reference})` : ""} · {o.district_name}, {o.province_name}, {o.department_name}
                </p>
                {o.zone === "provincia" && view !== "confirmar" ? (
                  <p className={`flex items-center gap-1 text-xs ${o.agency_destination ? "text-muted-foreground" : "text-amber-600 dark:text-amber-400"}`}>
                    <MapPin className="size-3.5" /> {o.agency_destination ? `Agencia ${o.agency_destination}` : "Falta la agencia de destino"}
                    {!o.dni ? " · Falta DNI" : ""}
                  </p>
                ) : null}
                {o.exported_at && view === "despachar" ? <p className="text-xs text-muted-foreground">Ya exportado · {formatDateTime(o.exported_at)}</p> : null}
                {o.tracking_code || o.courier_name || o.courier_id ? (
                  <p className="text-xs text-muted-foreground">
                    {o.courier_id ? courierName(o.courier_id) : (o.courier_name ?? "Courier")} {o.tracking_code ? `· Guía ${o.tracking_code}` : ""}
                  </p>
                ) : null}
                {view === "confirmar" ? (
                  // En el celular: Llamar, WhatsApp y los resultados con altura cómoda para el dedo
                  <div className="mt-1 max-md:[&_a]:min-h-11 max-md:[&_a]:flex-1 max-md:[&_a]:justify-center max-md:[&_button]:min-h-10">
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

      {any ? (
        <>
          {/* Celular: espacio para que la barra fija no tape la última tarjeta */}
          <div className="h-24 md:hidden" aria-hidden />
          {/* Celular: barra fija sobre la navegación inferior (≈56 px + zona segura) */}
          <div
            role="toolbar"
            aria-label="Acciones para los pedidos seleccionados"
            className="fixed inset-x-2 bottom-[calc(3.75rem+env(safe-area-inset-bottom))] z-30 flex flex-col gap-2 rounded-xl border bg-background/95 p-2 shadow-lg backdrop-blur md:hidden"
          >
            <div className="flex items-center gap-2 pl-1">
              <span className="text-sm font-medium">{selected.size} seleccionados</span>
              {!allSelected ? (
                <button type="button" onClick={() => setSelected(new Set(orders.map((o) => o.id)))} className="h-8 px-1 text-sm text-primary">
                  Todos ({orders.length})
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setSelected(new Set())}
                aria-label="Quitar selección"
                className="ml-auto flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>
            <div className={cn(SCROLL_ROW, "items-center gap-2")}>{actions("bottom")}</div>
          </div>
        </>
      ) : null}

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
          <AppSelect value={reason} onChange={(e) => setReason(e.target.value)} className="h-9 rounded-md border bg-background px-2 text-sm">
            {Object.entries(reasonAction?.reasons ?? {}).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </AppSelect>
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
