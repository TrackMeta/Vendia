"use client";

import { AlertTriangle, CheckCircle2, Download, Loader2, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { updateOrderShipping } from "@/app/dashboard/pedidos/actions";
import { AgencyPicker } from "@/components/dashboard/agency-picker";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatDateTime } from "@/lib/format";
import { buildCourierFile, COURIERS, reviewExport, toCourierOrder } from "@/modules/couriers";
import { deleteExportBatch, type ExportOrder, getBatchExport, getExportOrders, reserveExport } from "./actions";
import { CourierIcon } from "@/components/brand-icons";
import { mimeFor, saveFile } from "@/modules/app-native/files";

export type StoreCourier = {
  courier_id: string;
  zone: "lima" | "provincia";
  enabled: boolean;
  is_default: boolean;
  origin_agency: string | null;
};

async function generate(courierId: string, orders: ExportOrder[], originAgency: string | null) {
  const def = COURIERS[courierId];
  if (!def?.template) throw new Error(`${def?.name ?? courierId} todavía no tiene plantilla.`);
  const res = await fetch(`/couriers/${def.template}`);
  if (!res.ok) throw new Error(`No se pudo cargar la plantilla de ${def.name}.`);
  const out = await buildCourierFile(courierId, orders.map(toCourierOrder), await res.arrayBuffer(), { originAgency });
  await saveFile(out.bytes, out.fileName, mimeFor(out.fileName));
  return out.rows;
}

/**
 * Exportar pedidos confirmados a la plantilla oficial del courier (revisión previa + reserva atómica).
 * Se monta al abrir: carga los pedidos una sola vez (un refresco de la página no la interrumpe).
 */
export function ExportDialog({
  onClose,
  orderIds,
  couriers,
  onDone,
}: {
  onClose: () => void;
  orderIds: string[];
  couriers: StoreCourier[];
  onDone: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [initial] = useState(() => ({ ids: orderIds, couriers }));
  const [orders, setOrders] = useState<ExportOrder[] | null>(null);
  const [courierId, setCourierId] = useState("");
  const [origin, setOrigin] = useState(() => couriers.find((c) => c.courier_id === "shalom")?.origin_agency ?? "");
  const [markShipped, setMarkShipped] = useState(true);
  const [fixes, setFixes] = useState<Record<string, { dni: string; agency: string }>>({});
  const ready = couriers.filter((c) => c.enabled && COURIERS[c.courier_id]?.status === "ready");

  useEffect(() => {
    let active = true;
    getExportOrders(initial.ids).then((r) => {
      if (!active) return;
      if (!r.ok) {
        toast.error(r.error);
        setOrders([]);
        return;
      }
      const usable = initial.couriers.filter((c) => c.enabled && COURIERS[c.courier_id]?.status === "ready");
      const zones = new Set(r.orders.map((o) => o.zone));
      const zone = zones.size === 1 ? [...zones][0] : "provincia";
      const pick = usable.find((c) => c.zone === zone && c.is_default) ?? usable.find((c) => c.zone === zone) ?? usable[0];
      setCourierId(pick?.courier_id ?? "");
      setOrders(r.orders);
    });
    return () => {
      active = false;
    };
  }, [initial]);

  const close = (value: boolean) => {
    if (!value) onClose();
  };

  const courier = COURIERS[courierId];
  const included = (orders ?? []).filter((o) => !courier || o.zone === courier.zone);
  const excluded = (orders?.length ?? 0) - included.length;
  const warnings = courier
    ? reviewExport(courierId, included.map(toCourierOrder), {
        originAgency: origin || null,
      })
    : [];
  const needsFix = courierId === "shalom" ? included.filter((o) => !o.dni || !/^\d{8}$/.test(o.dni) || !o.agency_destination) : [];

  const saveFix = (o: ExportOrder) =>
    startTransition(async () => {
      const f = fixes[o.id] ?? {
        dni: o.dni ?? "",
        agency: o.agency_destination ?? "",
      };
      const r = await updateOrderShipping(o.id, {
        dni: f.dni,
        agency_destination: f.agency,
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      setOrders((list) => (list ?? []).map((x) => (x.id === o.id ? { ...x, dni: f.dni || null, agency_destination: f.agency || null } : x)));
      toast.success(`#${o.order_number} corregido`);
    });

  const doExport = () =>
    startTransition(async () => {
      const r = await reserveExport({
        courierId,
        orderIds: included.map((o) => o.id),
        originAgency: origin || undefined,
        markShipped,
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      try {
        const rows = await generate(courierId, r.orders, origin || null);
        toast.success(`${rows} pedido(s) exportados a ${courier?.name}${r.skipped ? ` · ${r.skipped} ya estaban exportados` : ""}`, {
          description: markShipped ? "Quedaron como «Enviado». Puedes volver a descargar el lote abajo." : "Puedes volver a descargar el lote abajo.",
        });
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "No se pudo generar el Excel", {
          description: "Los pedidos ya quedaron reservados: descárgalo desde «Lotes exportados».",
        });
      }
      close(false);
      onDone();
      router.refresh();
    });

  return (
    <Dialog open onOpenChange={close}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Exportar a la planilla del courier</DialogTitle>
          <DialogDescription>Se llena la plantilla oficial de carga masiva. Cada pedido se exporta una sola vez.</DialogDescription>
        </DialogHeader>

        {!orders ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Revisando pedidos…
          </p>
        ) : !ready.length ? (
          <p className="text-sm text-muted-foreground">No tienes couriers con plantilla activos. Actívalos en Configuración → Couriers.</p>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-2">
              {ready.map((c) => (
                <button
                  key={c.courier_id}
                  type="button"
                  onClick={() => setCourierId(c.courier_id)}
                  className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 text-left text-sm ${courierId === c.courier_id ? "border-primary bg-primary/10" : "hover:bg-muted"}`}
                >
                  <CourierIcon id={c.courier_id} className="size-8" />
                  <span>
                    <span className="font-medium">{COURIERS[c.courier_id].name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {c.zone === "lima" ? "Lima" : "Provincia"} · {(orders ?? []).filter((o) => o.zone === c.zone).length} pedido(s)
                    </span>
                  </span>
                </button>
              ))}
              {couriers
                .filter((c) => COURIERS[c.courier_id]?.status === "soon")
                .map((c) => (
                  <span key={c.courier_id} className="rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground">
                    {COURIERS[c.courier_id].name}
                    <span className="block text-xs">Próximamente</span>
                  </span>
                ))}
            </div>
            {excluded ? (
              <p className="text-xs text-muted-foreground">
                {excluded} pedido(s) de {courier?.zone === "lima" ? "provincia" : "Lima"} no van en esta planilla: expórtalos con su courier.
              </p>
            ) : null}

            {courierId === "shalom" ? (
              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-medium">Agencia de origen (desde donde despachas)</span>
                <AgencyPicker kind="origin" value={origin} onChange={setOrigin} />
              </div>
            ) : null}

            {needsFix.length ? (
              <div className="flex flex-col gap-2 rounded-lg border p-3">
                <p className="text-sm font-medium">Completa DNI y agencia de destino</p>
                {needsFix.map((o) => {
                  const f = fixes[o.id] ?? {
                    dni: o.dni ?? "",
                    agency: o.agency_destination ?? "",
                  };
                  const setF = (patch: Partial<typeof f>) => setFixes((s) => ({ ...s, [o.id]: { ...f, ...patch } }));
                  return (
                    <div key={o.id} className="grid items-start gap-2 border-t pt-2 sm:grid-cols-[7rem_8rem_1fr_auto]">
                      <span className="text-sm">
                        #{o.order_number}
                        <span className="block text-xs text-muted-foreground">
                          {o.province_name}, {o.district_name}
                        </span>
                      </span>
                      <input
                        value={f.dni}
                        onChange={(e) =>
                          setF({
                            dni: e.target.value.replace(/\D/g, "").slice(0, 8),
                          })
                        }
                        inputMode="numeric"
                        placeholder="DNI"
                        aria-label={`DNI del pedido ${o.order_number}`}
                        className="h-9 rounded-md border bg-background px-2 text-sm"
                      />
                      <AgencyPicker value={f.agency} onChange={(v) => setF({ agency: v })} hint={`${o.province_name} ${o.district_name}`} />
                      <Button size="sm" variant="outline" disabled={pending} onClick={() => saveFix(o)}>
                        Guardar
                      </Button>
                    </div>
                  );
                })}
              </div>
            ) : null}

            {warnings.length ? (
              <ul className="flex flex-col gap-1 rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
                {warnings.slice(0, 12).map((w) => (
                  <li key={w} className="flex gap-2">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {w}
                  </li>
                ))}
                {warnings.length > 12 ? <li>…y {warnings.length - 12} avisos más.</li> : null}
              </ul>
            ) : included.length ? (
              <p className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 className="size-4" /> {included.length} pedido(s) listos para {courier?.name}.
              </p>
            ) : null}

            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={markShipped} onChange={(e) => setMarkShipped(e.target.checked)} className="size-4" />
              Marcar como «Enviado» al exportar
            </label>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)}>
            Cancelar
          </Button>
          {warnings.length ? (
            <Button variant="outline" disabled={pending || !included.length} onClick={doExport}>
              Exportar igual
            </Button>
          ) : null}
          <Button disabled={pending || !included.length || !courier || warnings.length > 0} onClick={doExport}>
            {pending ? <Loader2 className="animate-spin" /> : <Download />} Exportar {included.length || ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export type BatchRow = {
  id: string;
  courier_id: string;
  order_count: number;
  created_at: string;
  created_by_name: string;
};

/** Historial de lotes exportados, con opción de volver a descargar el mismo archivo. */
export function BatchesList({ batches, canDelete = false }: { batches: BatchRow[]; canDelete?: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirm, setConfirm] = useState<BatchRow | null>(null);
  if (!batches.length) return null;
  const remove = (b: BatchRow) =>
    startTransition(async () => {
      const r = await deleteExportBatch(b.id);
      setConfirm(null);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success("Lote quitado del historial");
      router.refresh();
    });
  const again = (id: string) =>
    startTransition(async () => {
      const r = await getBatchExport(id);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      try {
        await generate(r.courierId, r.orders, r.originAgency);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "No se pudo generar el Excel");
      }
    });
  return (
    <div className="flex flex-col gap-2 rounded-xl border p-3">
      <p className="flex items-baseline justify-between gap-2 text-sm font-medium">
        Lotes exportados <span className="text-xs font-normal text-muted-foreground">Se borran solos a los 30 días</span>
      </p>
      <ul className="flex flex-col divide-y text-sm">
        {batches.map((b) => (
          <li key={b.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
            <span className="flex items-center gap-1.5 font-medium">
              <CourierIcon id={b.courier_id} className="size-4" />
              {COURIERS[b.courier_id]?.name ?? b.courier_id}
            </span>
            <span className="text-muted-foreground">
              {b.order_count} pedido(s) · {formatDateTime(b.created_at)} · {b.created_by_name}
            </span>
            <span className="ml-auto flex items-center gap-1">
              <Button size="sm" variant="outline" disabled={pending} onClick={() => again(b.id)}>
                <Download /> Descargar de nuevo
              </Button>
              {canDelete ? (
                <Button size="icon-sm" variant="ghost" disabled={pending} onClick={() => setConfirm(b)} aria-label="Quitar lote" title="Quitar del historial" className="text-muted-foreground">
                  <Trash2 />
                </Button>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
      <Dialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>¿Quitar este lote del historial?</DialogTitle>
            <DialogDescription>
              Los pedidos no cambian: siguen marcados como exportados. Solo ya no podrás volver a descargar este Excel desde aquí.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)} disabled={pending}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={() => confirm && remove(confirm)} disabled={pending}>
              {pending ? <Loader2 className="animate-spin" /> : <Trash2 />} Quitar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
