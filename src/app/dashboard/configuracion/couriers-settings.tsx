"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { AgencyPicker } from "@/components/dashboard/agency-picker";
import { SimpleBadge } from "@/components/dashboard/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { COURIERS } from "@/modules/couriers";
import { saveCourierSettings } from "./actions";

export type CourierSettingsRow = {
  courier_id: string;
  enabled: boolean;
  is_default: boolean;
  shipping_cost: number;
  return_shipments: number;
  origin_agency: string | null;
};

function CourierRow({ initial }: { initial: CourierSettingsRow }) {
  const def = COURIERS[initial.courier_id];
  const [pending, startTransition] = useTransition();
  const [d, setD] = useState(initial);
  const soon = def.status === "soon";
  const save = () =>
    startTransition(async () => {
      const r = await saveCourierSettings({ ...d, origin_agency: d.origin_agency ?? "" });
      if (r.ok) toast.success(r.message ?? "Guardado");
      else toast.error(r.error);
    });

  return (
    <div className={`flex flex-col gap-3 rounded-xl border p-3 ${soon ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="size-3 rounded-full" style={{ backgroundColor: def.color }} />
        <span className="font-medium">{def.name}</span>
        <SimpleBadge tone={def.zone === "lima" ? "info" : "progress"}>{def.zone === "lima" ? "Lima" : "Provincia"}</SimpleBadge>
        {soon ? <SimpleBadge>Próximamente</SimpleBadge> : null}
        {!soon ? (
          <label className="ml-auto flex items-center gap-2 text-sm">
            <input type="checkbox" checked={d.enabled} onChange={(e) => setD({ ...d, enabled: e.target.checked })} className="size-4" />
            Activo
          </label>
        ) : null}
      </div>
      {!soon && d.enabled ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`cost-${def.id}`}>Costo de envío sugerido (S/)</Label>
            <Input
              id={`cost-${def.id}`}
              type="number"
              step="0.01"
              min={0}
              value={d.shipping_cost}
              onChange={(e) => setD({ ...d, shipping_cost: Number(e.target.value) || 0 })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`ret-${def.id}`}>Si no se entrega, cobra</Label>
            <select
              id={`ret-${def.id}`}
              value={d.return_shipments}
              onChange={(e) => setD({ ...d, return_shipments: Number(e.target.value) })}
              className="h-9 rounded-lg border border-input bg-transparent px-2.5 text-sm"
            >
              <option value={0}>Nada</option>
              <option value={1}>1 envío</option>
              <option value={2}>2 envíos (ida y vuelta)</option>
            </select>
          </div>
          <label className="flex items-center gap-2 self-end pb-2 text-sm">
            <input type="checkbox" checked={d.is_default} onChange={(e) => setD({ ...d, is_default: e.target.checked })} className="size-4" />
            Predeterminado en {def.zone === "lima" ? "Lima" : "provincia"}
          </label>
          {def.id === "shalom" ? (
            <div className="flex flex-col gap-1.5 sm:col-span-3">
              <Label>Agencia de origen predeterminada</Label>
              <AgencyPicker kind="origin" value={d.origin_agency ?? ""} onChange={(v) => setD({ ...d, origin_agency: v || null })} />
              <p className="text-xs text-muted-foreground">Desde donde despachas normalmente. La puedes cambiar al exportar.</p>
            </div>
          ) : null}
        </div>
      ) : null}
      {!soon ? (
        <div className="flex justify-end">
          <Button size="sm" onClick={save} disabled={pending}>
            {pending ? "Guardando…" : "Guardar"}
          </Button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Falta su plantilla de carga masiva. Mientras tanto puedes usar el CSV genérico.</p>
      )}
    </div>
  );
}

/** Couriers de la tienda: Eva (Lima), Shalom (provincia), Olva próximamente. Catálogo ampliable. */
export function CouriersSettings({ rows }: { rows: CourierSettingsRow[] }) {
  const all = Object.values(COURIERS).map(
    (c) =>
      rows.find((r) => r.courier_id === c.id) ?? {
        courier_id: c.id,
        enabled: false,
        is_default: false,
        shipping_cost: 0,
        return_shipments: 1,
        origin_agency: null,
      },
  );
  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>Couriers</CardTitle>
        <CardDescription>
          Con quién despachas. El costo sugerido se pone en cada pedido al confirmarlo (lo puedes editar). Cada pedido se exporta a la plantilla oficial del
          courier.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {all.map((r) => (
          <CourierRow key={r.courier_id} initial={r} />
        ))}
      </CardContent>
    </Card>
  );
}
