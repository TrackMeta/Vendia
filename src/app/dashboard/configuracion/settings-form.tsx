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
  purchase_trigger_status: string;
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
  const [example, setExample] = useState({ lima: initial.shipping_lima, advance: initial.advance_amount });

  useEffect(() => {
    if (!state) return;
    if (state.ok) toast.success(state.message ?? "Guardado");
    else toast.error(state.error);
  }, [state]);

  const productPrice = 79;
  const total = productPrice + example.lima;

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
            <Input name="shipping_province" type="number" step="0.01" min="0" defaultValue={initial.shipping_province} />
          </Field>
          <Field label="Adelanto (S/)" hint="0 = sin adelanto">
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
            <p className="mb-1 font-medium">Ejemplo con un producto de {formatMoney(productPrice)} en Lima:</p>
            <p className="text-muted-foreground">
              Producto {formatMoney(productPrice)} + envío {formatMoney(example.lima)} = total {formatMoney(total)}
              {example.advance > 0
                ? ` · adelanto ${formatMoney(Math.min(example.advance, total))} · saldo al recibir ${formatMoney(total - Math.min(example.advance, total))}`
                : ""}
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
            ¿Qué estado cuenta como venta real? Al llegar a ese estado, Vendia envía «Purchase» a Meta (si conectaste tu Pixel en Marketing). Recomendado: Entregado.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <select name="purchase_trigger_status" defaultValue={initial.purchase_trigger_status} className="h-9 w-full max-w-xs rounded-lg border border-input bg-transparent px-2.5 text-sm">
            <option value="delivered">Entregado (recomendado)</option>
            <option value="collected">Cobrado (el courier ya te pagó)</option>
            <option value="shipped">Enviado</option>
            <option value="confirmed">Confirmado</option>
          </select>
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
