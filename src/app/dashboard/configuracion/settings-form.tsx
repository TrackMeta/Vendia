"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatMoney } from "@/lib/format";
import { ImageField } from "@/components/dashboard/fields";
import { REAL_SALE_MODES } from "@/modules/metrics/real-sale";
import { saveSettings } from "./actions";

type Values = {
  name: string;
  whatsapp: string;
  phone: string;
  email: string;
  address: string;
  logo_path: string;
  favicon_path: string;
  shipping_lima: number;
  shipping_province: number;
  advance_amount: number;
  payment_methods: string;
  confirmation_message: string;
  real_sale_mode: string;
  ad_currency: string;
  usd_rate: number;
  apply_igv: boolean;
  contact_calls: number;
  contact_whatsapp: boolean;
};

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <Label>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function SettingsForm({ storeId, storeSlug, initial }: { storeId: string; storeSlug: string; initial: Values }) {
  const [state, action, pending] = useActionState(saveSettings, undefined);
  const [logo, setLogo] = useState(initial.logo_path);
  const [favicon, setFavicon] = useState(initial.favicon_path);
  const [example, setExample] = useState({ lima: initial.shipping_lima, province: initial.shipping_province, advance: initial.advance_amount });

  useEffect(() => {
    if (!state) return;
    if (state.ok) toast.success(state.message ?? "Guardado");
    else toast.error(state.error);
  }, [state]);

  const productPrice = 79;
  const total = productPrice + example.lima;
  const provinceTotal = productPrice + example.province;

  return (
    <form action={action} className="flex flex-col gap-6">
      <input type="hidden" name="logo_path" value={logo} />
      <input type="hidden" name="favicon_path" value={favicon} />

      <Card>
        <CardHeader>
          <CardTitle>Tienda</CardTitle>
          <CardDescription>País: Perú · Moneda: soles (S/) · Enlace: /p/{storeSlug}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Nombre de la tienda">
            <Input name="name" defaultValue={initial.name} required />
          </Field>
          <Field label="WhatsApp" hint="Aparece en la página de gracias para que el cliente te escriba.">
            <Input name="whatsapp" defaultValue={initial.whatsapp} placeholder="987 654 321" inputMode="tel" />
          </Field>
          <Field label="Teléfono">
            <Input name="phone" defaultValue={initial.phone} inputMode="tel" />
          </Field>
          <Field label="Correo">
            <Input name="email" type="email" defaultValue={initial.email} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Dirección">
              <Input name="address" defaultValue={initial.address} />
            </Field>
          </div>
          <ImageField label="Logo" value={logo} onChange={setLogo} storeId={storeId} folder="brand" maxSize={600} />
          <ImageField label="Favicon (ícono de la pestaña)" value={favicon} onChange={setFavicon} storeId={storeId} folder="brand" maxSize={128} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Contraentrega (COD)</CardTitle>
          <CardDescription>El envío se calcula en el servidor según el distrito: Lima Metropolitana y Callao pagan tarifa Lima.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <Field label="Envío Lima y Callao (S/)">
            <Input
              name="shipping_lima"
              type="number"
              step="0.01"
              min="0"
              defaultValue={initial.shipping_lima}
              onChange={(e) => setExample((x) => ({ ...x, lima: Number(e.target.value) || 0 }))}
            />
          </Field>
          <Field label="Envío provincias (S/)">
            <Input
              name="shipping_province"
              type="number"
              step="0.01"
              min="0"
              defaultValue={initial.shipping_province}
              onChange={(e) => setExample((x) => ({ ...x, province: Number(e.target.value) || 0 }))}
            />
          </Field>
          <Field label="Adelanto en provincia (S/)" hint="Lima es contraentrega: no lleva adelanto. 0 = sin adelanto">
            <Input
              name="advance_amount"
              type="number"
              step="0.01"
              min="0"
              defaultValue={initial.advance_amount}
              onChange={(e) => setExample((x) => ({ ...x, advance: Number(e.target.value) || 0 }))}
            />
          </Field>
          <div className="rounded-lg bg-muted/50 p-3 text-sm sm:col-span-3">
            <p className="mb-1 font-medium">Ejemplo con un producto de {formatMoney(productPrice)}:</p>
            <p className="text-muted-foreground">
              Lima: {formatMoney(productPrice)} + envío {formatMoney(example.lima)} = {formatMoney(total)}, se paga todo al recibir.
            </p>
            <p className="text-muted-foreground">
              Provincia: {formatMoney(productPrice)} + envío {formatMoney(example.province)} = {formatMoney(provinceTotal)}
              {example.advance > 0
                ? ` · adelanto ${formatMoney(Math.min(example.advance, provinceTotal))} · saldo en agencia ${formatMoney(provinceTotal - Math.min(example.advance, provinceTotal))}`
                : ", se paga todo en la agencia."}
            </p>
          </div>
          <div className="sm:col-span-3">
            <Field label="Métodos de pago" hint="Separados por comas. Ej: Contraentrega, Yape, Plin">
              <Input name="payment_methods" defaultValue={initial.payment_methods} />
            </Field>
          </div>
          <div className="sm:col-span-3">
            <Field label="Mensaje de confirmación" hint="Se muestra en la página de gracias después del pedido.">
              <Textarea name="confirmation_message" defaultValue={initial.confirmation_message} rows={3} />
            </Field>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Secuencia de contacto</CardTitle>
          <CardDescription>
            Cómo se confirma cada pedido. Los intentos se hacen seguidos; se puede cancelar desde el primero. Al terminar la secuencia sin respuesta, Vendia
            te avisa (no cancela solo).
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-6">
          <Field label="Cantidad de llamadas">
            <Input name="contact_calls" type="number" min={0} max={6} defaultValue={initial.contact_calls} className="w-24" />
          </Field>
          <label className="flex items-center gap-2 pb-2 text-sm">
            <input type="checkbox" name="contact_whatsapp" defaultChecked={initial.contact_whatsapp} className="size-4" />
            Terminar con un mensaje por WhatsApp
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Venta real</CardTitle>
          <CardDescription>
            Un pedido no es una venta. Elige cuándo cuenta como venta: se usa en todas tus métricas (CPA real, ROAS real, utilidad) y para enviar «Purchase» a Meta.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {(Object.entries(REAL_SALE_MODES) as [string, string][]).map(([value, label]) => (
            <label key={value} className="flex items-start gap-2 text-sm">
              <input type="radio" name="real_sale_mode" value={value} defaultChecked={initial.real_sale_mode === value} className="mt-0.5 size-4" />
              <span>
                <span className="font-medium">{label}</span>
                <span className="block text-xs text-muted-foreground">
                  {value === "zone"
                    ? "Recomendado: en provincia el cliente ya pagó el saldo en la agencia aunque aún no recoja."
                    : "Más conservador: en provincia espera a que el cliente recoja su pedido."}
                </span>
              </span>
            </label>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Gasto publicitario</CardTitle>
          <CardDescription>Moneda de tu cuenta publicitaria. Vendia convierte cada gasto a soles y guarda el tipo de cambio usado.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <Field label="Moneda de la cuenta">
            <select name="ad_currency" defaultValue={initial.ad_currency} className="h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm">
              <option value="PEN">Soles (S/)</option>
              <option value="USD">Dólares (US$)</option>
            </select>
          </Field>
          <Field label="Tipo de cambio (S/ por US$)" hint="Valor sugerido al registrar gastos en dólares. Lo puedes cambiar en cada gasto.">
            <Input name="usd_rate" type="number" step="0.0001" min="1" defaultValue={initial.usd_rate} />
          </Field>
          <label className="flex items-center gap-2 self-center text-sm">
            <input type="checkbox" name="apply_igv" defaultChecked={initial.apply_igv} className="size-4" />
            Sumar IGV 18 % al gasto en publicidad
          </label>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? "Guardando…" : "Guardar configuración"}
        </Button>
      </div>
    </form>
  );
}
