"use client";

import { Copy, RefreshCw, Send } from "lucide-react";
import { useActionState, useEffect, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { retryFailedEvents, saveMetaSettings, sendTestEvent } from "./actions";

export const URL_TEMPLATE =
  "utm_source=facebook&utm_medium=paid&utm_campaign={{campaign.name}}&utm_content={{ad.name}}&utm_term={{adset.name}}&campaign_id={{campaign.id}}&adset_id={{adset.id}}&ad_id={{ad.id}}";

function Check({ name, label, hint, defaultChecked }: { name: string; label: string; hint?: string; defaultChecked: boolean }) {
  return (
    <label className="flex items-start gap-3">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="mt-0.5 size-4" />
      <span className="flex flex-col">
        <span className="text-sm font-medium">{label}</span>
        {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
      </span>
    </label>
  );
}

export function MetaSettingsForm({
  initial,
  tokenConfigured,
}: {
  initial: { pixel_id: string; test_event_code: string; enabled: boolean; send_lead: boolean; send_purchase: boolean };
  tokenConfigured: boolean;
}) {
  const [state, action, pending] = useActionState(saveMetaSettings, undefined);
  useEffect(() => {
    if (!state) return;
    if (state.ok) toast.success(state.message ?? "Guardado");
    else toast.error(state.error);
  }, [state]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Conectar Meta</CardTitle>
        <CardDescription>
          Events Manager → tu Pixel → Configuración. El token se genera en «Conversions API → Generar token de acceso». Se guarda cifrado y nunca se
          envía al navegador.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="pixel_id">Pixel ID (identificador del conjunto de datos)</Label>
            <Input id="pixel_id" name="pixel_id" inputMode="numeric" defaultValue={initial.pixel_id} placeholder="123456789012345" />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="test_event_code">Código de prueba (opcional)</Label>
            <Input id="test_event_code" name="test_event_code" defaultValue={initial.test_event_code} placeholder="TEST12345" />
            <p className="text-xs text-muted-foreground">Mientras esté puesto, los eventos van a «Probar eventos». Quítalo al terminar de probar.</p>
          </div>
          <div className="flex flex-col gap-2 sm:col-span-2">
            <Label htmlFor="token">Token de acceso de Conversions API</Label>
            <Input
              id="token"
              name="token"
              type="password"
              autoComplete="off"
              placeholder={tokenConfigured ? "•••••••• configurado — deja vacío para mantenerlo" : "EAAG..."}
            />
            {tokenConfigured ? (
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input type="checkbox" name="clear_token" className="size-3.5" /> Eliminar el token guardado
              </label>
            ) : null}
          </div>
          <div className="flex flex-col gap-3 sm:col-span-2">
            <Check name="enabled" label="Activar Meta en mis landings" hint="Carga el Pixel y envía eventos de servidor." defaultChecked={initial.enabled} />
            <Check name="send_lead" label="Enviar Lead por servidor al recibir un pedido" defaultChecked={initial.send_lead} />
            <Check
              name="send_purchase"
              label="Enviar Purchase por servidor cuando el pedido sea venta real"
              hint="Nunca se envía Purchase solo por abrir o llenar el formulario."
              defaultChecked={initial.send_purchase}
            />
          </div>
          <div className="flex justify-end sm:col-span-2">
            <Button type="submit" disabled={pending}>
              {pending ? "Guardando…" : "Guardar"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

export function UrlTemplate() {
  return (
    <div className="flex flex-col gap-2">
      <code className="block rounded-md bg-muted p-3 text-xs break-all">{URL_TEMPLATE}</code>
      <Button
        variant="outline"
        size="sm"
        className="w-fit"
        onClick={() => {
          void navigator.clipboard.writeText(URL_TEMPLATE);
          toast.success("Plantilla copiada");
        }}
      >
        <Copy /> Copiar
      </Button>
    </div>
  );
}

export function TestEventButton() {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const r = await sendTestEvent();
          if (r.ok) toast.success(r.message ?? "Enviado");
          else toast.error(r.error);
        })
      }
    >
      <Send /> {pending ? "Enviando…" : "Enviar evento de prueba"}
    </Button>
  );
}

export function RetryButton({ count }: { count: number }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const r = await retryFailedEvents();
          if (r.ok) toast.success(r.message ?? "Listo");
          else toast.error(r.error);
        })
      }
    >
      <RefreshCw /> Reintentar {count} fallidos
    </Button>
  );
}
