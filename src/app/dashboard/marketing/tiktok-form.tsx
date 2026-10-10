"use client";

import { Send } from "lucide-react";
import { useActionState, useEffect, useTransition } from "react";
import { toast } from "sonner";
import { BrandIcon } from "@/components/brand-icons";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TIKTOK_URL_TEMPLATE } from "@/modules/tiktok/events";
import { UrlTemplateDetails } from "./events-signal";
import { saveTikTokSettings, sendTikTokTestEvent } from "./tiktok-actions";

function TikTokTestButton() {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const r = await sendTikTokTestEvent();
          if (r.ok) toast.success(r.message ?? "Enviado");
          else toast.error(r.error);
        })
      }
    >
      <Send /> {pending ? "Enviando…" : "Enviar evento de prueba"}
    </Button>
  );
}

/**
 * TikTok: lo esencial a la vista (Pixel, token, activar) y lo técnico en «Avanzado»
 * (código de prueba, qué eventos se envían y el evento de prueba).
 */
export function TikTokSettingsForm({
  initial,
  tokenConfigured,
  signal,
}: {
  initial: { pixel_code: string; test_event_code: string; enabled: boolean; send_lead: boolean; send_purchase: boolean };
  tokenConfigured: boolean;
  /** ¿TikTok está recibiendo los eventos? (una línea, arriba) */
  signal?: React.ReactNode;
}) {
  const [state, action, pending] = useActionState(saveTikTokSettings, undefined);
  useEffect(() => {
    if (!state) return;
    if (state.ok) toast.success(state.message ?? "Guardado");
    else toast.error(state.error);
  }, [state]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BrandIcon name="tiktok" className="size-6" /> TikTok
        </CardTitle>
        <CardDescription>Para cuando anuncies en TikTok: Vendia pone su Pixel en tus landings y le avisa tus pedidos y ventas reales.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {signal}
        <form action={action} className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tt-pixel">Pixel code</Label>
            <Input id="tt-pixel" name="pixel_code" defaultValue={initial.pixel_code} placeholder="C4ABCD1234EFGH5678" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tt-token">Access token de Events API {tokenConfigured ? <span className="font-normal text-emerald-600">· configurado</span> : null}</Label>
            <Input
              id="tt-token"
              name="token"
              type="password"
              autoComplete="off"
              placeholder={tokenConfigured ? "Déjalo vacío para mantener el actual" : "Pégalo desde TikTok Events Manager"}
            />
          </div>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" name="enabled" defaultChecked={initial.enabled} className="size-4" /> Activar TikTok en mis landings
          </label>

          <details className="group rounded-lg border sm:col-span-2">
            <summary className="cursor-pointer list-none px-3 py-2.5 text-sm font-medium marker:hidden">
              <span className="mr-1 inline-block transition-transform group-open:rotate-90">›</span> Avanzado
            </summary>
            <div className="flex flex-col gap-4 border-t px-3 py-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="tt-test">Código de prueba (opcional)</Label>
                <Input id="tt-test" name="test_event_code" defaultValue={initial.test_event_code} placeholder="TEST12345" className="max-w-60" />
                <p className="text-xs text-muted-foreground">Mientras esté puesto, los eventos van a «Probar eventos» de TikTok. Quítalo al terminar.</p>
              </div>
              <div className="flex flex-col gap-2 text-sm">
                <label className="flex items-center gap-2">
                  <input type="checkbox" name="send_lead" defaultChecked={initial.send_lead} className="size-4" /> Enviar SubmitForm (pedido)
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" name="send_purchase" defaultChecked={initial.send_purchase} className="size-4" /> Enviar CompletePayment (venta real)
                </label>
                {tokenConfigured ? (
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <input type="checkbox" name="clear_token" className="size-3.5" /> Borrar el token guardado
                  </label>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-3 border-t pt-3">
                <TikTokTestButton />
                <span className="text-xs text-muted-foreground">Guarda primero el código de prueba; el evento aparece en TikTok Events Manager → Probar eventos.</span>
              </div>
            </div>
          </details>

          <div className="flex justify-end sm:col-span-2">
            <Button type="submit" disabled={pending}>
              {pending ? "Guardando…" : "Guardar TikTok"}
            </Button>
          </div>
        </form>
        <UrlTemplateDetails template={TIKTOK_URL_TEMPLATE} where="TikTok Ads → Anuncio → Parámetros de URL" />
      </CardContent>
    </Card>
  );
}
