"use client";

import { Eye, EyeOff, KeyRound } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { AgencyPicker } from "@/components/dashboard/agency-picker";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatMoney } from "@/lib/format";
import { COURIERS, PACKAGE_SIZES } from "@/modules/couriers";
import { updateOrderShipping } from "../actions";

export type ShippingData = {
  zone: "lima" | "provincia";
  status: string;
  courier_id: string | null;
  tracking_code: string | null;
  courier_order_number: string | null;
  agency_destination: string | null;
  agency_origin: string | null;
  pickup_key: string | null;
  package_size: string | null;
  package_weight: number | null;
  shipping_cost: number;
  return_shipments: number | null;
  dni: string | null;
  exported_at: string | null;
};

const selectClass = "h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm";

function Field({ label, htmlFor, hint, children }: { label: string; htmlFor?: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/**
 * Datos de envío del pedido. En provincia: agencia de destino (la elige el cliente al confirmar),
 * número de orden, código de envío y clave de recojo (solo la ve el equipo).
 */
export function ShippingCard({
  orderId,
  initial,
  locationHint,
  defaultSize,
  defaultWeight,
  storeCouriers,
}: {
  orderId: string;
  initial: ShippingData;
  locationHint: string;
  defaultSize: string;
  defaultWeight: number;
  storeCouriers: { courier_id: string; zone: string; enabled: boolean }[];
}) {
  const [pending, startTransition] = useTransition();
  const [d, setD] = useState(initial);
  const [showKey, setShowKey] = useState(false);
  const set = <K extends keyof ShippingData>(k: K, v: ShippingData[K]) => setD((s) => ({ ...s, [k]: v }));
  const provincia = d.zone === "provincia";
  const failed = d.status === "failed_delivery" || d.status === "returned";
  const options = storeCouriers.filter((c) => c.enabled && COURIERS[c.courier_id]?.status !== "soon");
  if (d.courier_id && !options.some((c) => c.courier_id === d.courier_id)) options.push({ courier_id: d.courier_id, zone: d.zone, enabled: true });

  const save = () =>
    startTransition(async () => {
      const r = await updateOrderShipping(orderId, {
        courier_id: d.courier_id ?? "",
        tracking_code: d.tracking_code ?? "",
        courier_order_number: d.courier_order_number ?? "",
        agency_destination: d.agency_destination ?? "",
        pickup_key: d.pickup_key ?? "",
        package_size: d.package_size ?? "",
        package_weight: d.package_weight ?? "",
        shipping_cost: d.shipping_cost,
        return_shipments: d.return_shipments ?? "",
        dni: d.dni ?? "",
      });
      if (r.ok) toast.success(r.message ?? "Guardado");
      else toast.error(r.error);
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Envío</CardTitle>
        <CardDescription>
          {provincia
            ? "Provincia: el cliente recoge en su agencia con DNI y la clave de recojo, después de pagar el saldo."
            : "Lima: contraentrega, el courier cobra en la puerta."}
          {d.exported_at ? " · Ya se exportó a la planilla del courier." : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <Field label="Courier" htmlFor="courier_id">
          <select id="courier_id" value={d.courier_id ?? ""} onChange={(e) => set("courier_id", e.target.value || null)} className={selectClass}>
            <option value="">Sin asignar</option>
            {options.map((c) => (
              <option key={c.courier_id} value={c.courier_id}>
                {COURIERS[c.courier_id]?.name ?? c.courier_id} · {c.zone === "lima" ? "Lima" : "Provincia"}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Costo de envío pagado (S/)" htmlFor="shipping_cost" hint="Lo que te cobra el courier por este pedido. Se descuenta de tu utilidad.">
          <Input id="shipping_cost" type="number" step="0.01" min={0} value={d.shipping_cost} onChange={(e) => set("shipping_cost", Number(e.target.value) || 0)} />
        </Field>

        {provincia ? (
          <>
            <Field label="DNI del cliente" htmlFor="dni" hint="Obligatorio en provincia: lo pide la agencia para entregar.">
              <Input id="dni" inputMode="numeric" maxLength={8} value={d.dni ?? ""} onChange={(e) => set("dni", e.target.value.replace(/\D/g, ""))} />
            </Field>
            <Field label="Agencia de destino">
              <AgencyPicker value={d.agency_destination ?? ""} onChange={(v) => set("agency_destination", v || null)} hint={locationHint} />
            </Field>
            <Field label="Número de orden" htmlFor="courier_order_number" hint="El que te da la agencia al despachar.">
              <Input id="courier_order_number" value={d.courier_order_number ?? ""} onChange={(e) => set("courier_order_number", e.target.value)} />
            </Field>
            <Field label="Código de envío / guía" htmlFor="tracking_code">
              <Input id="tracking_code" value={d.tracking_code ?? ""} onChange={(e) => set("tracking_code", e.target.value)} />
            </Field>
            <Field label="Clave de recojo" htmlFor="pickup_key" hint="Solo la ve tu equipo. Se la envías al cliente cuando pague el saldo.">
              <div className="relative">
                <KeyRound className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="pickup_key"
                  type={showKey ? "text" : "password"}
                  autoComplete="off"
                  className="pr-9 pl-8"
                  value={d.pickup_key ?? ""}
                  onChange={(e) => set("pickup_key", e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setShowKey((v) => !v)}
                  className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground"
                  aria-label={showKey ? "Ocultar clave" : "Mostrar clave"}
                >
                  {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </Field>
            {d.agency_origin ? (
              <Field label="Agencia de origen">
                <p className="flex h-9 items-center text-sm">{d.agency_origin}</p>
              </Field>
            ) : null}
          </>
        ) : (
          <div className="sm:col-span-2">
            <Field label="Código de seguimiento / guía" htmlFor="tracking_code">
              <Input id="tracking_code" value={d.tracking_code ?? ""} onChange={(e) => set("tracking_code", e.target.value)} />
            </Field>
          </div>
        )}

        <Field label="Medida del paquete" htmlFor="package_size" hint={`Por defecto la del producto: ${defaultSize}.`}>
          <select id="package_size" value={d.package_size ?? ""} onChange={(e) => set("package_size", e.target.value || null)} className={selectClass}>
            <option value="">La del producto ({defaultSize})</option>
            {PACKAGE_SIZES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Peso (kg)" htmlFor="package_weight">
          <Input
            id="package_weight"
            type="number"
            step="0.1"
            min={0}
            value={d.package_weight ?? ""}
            placeholder={String(defaultWeight)}
            onChange={(e) => set("package_weight", e.target.value === "" ? null : Number(e.target.value))}
          />
        </Field>

        {failed ? (
          <div className="sm:col-span-2">
            <Field label="Costo de la devolución" hint="Cuántos envíos te cobró el courier por este pedido que no se entregó.">
              <div className="flex flex-wrap gap-2">
                {[0, 1, 2].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => set("return_shipments", n)}
                    className={`rounded-lg border px-3 py-1.5 text-sm ${(d.return_shipments ?? 1) === n ? "border-primary bg-primary/10 font-medium text-primary" : "hover:bg-muted"}`}
                  >
                    {n === 0 ? "Sin costo" : `${n} envío${n > 1 ? "s" : ""}`} · {formatMoney(n * d.shipping_cost)}
                  </button>
                ))}
              </div>
            </Field>
          </div>
        ) : null}

        <div className="flex justify-end sm:col-span-2">
          <Button onClick={save} disabled={pending}>
            {pending ? "Guardando…" : "Guardar envío"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
