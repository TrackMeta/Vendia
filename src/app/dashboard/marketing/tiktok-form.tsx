"use client";

import { Copy } from "lucide-react";
import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TIKTOK_URL_TEMPLATE } from "@/modules/tiktok/events";
import { saveTikTokSettings } from "./tiktok-actions";
import { BrandIcon } from "@/components/brand-icons";

export function TikTokSettingsForm({
  initial,
  tokenConfigured,
}: {
  initial: { pixel_code: string; test_event_code: string; enabled: boolean; send_lead: boolean; send_purchase: boolean };
  tokenConfigured: boolean;
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
        <CardDescription>
          Listo para cuando anuncies en TikTok: Pixel en tus landings (ViewContent, ClickButton, SubmitForm) y Events API desde el servidor (SubmitForm y
          CompletePayment cuando hay venta real), con el mismo id para que TikTok no cuente doble.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tt-pixel">Pixel code</Label>
            <Input id="tt-pixel" name="pixel_code" defaultValue={initial.pixel_code} placeholder="C4ABCD1234EFGH5678" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tt-test">Código de prueba (opcional)</Label>
            <Input id="tt-test" name="test_event_code" defaultValue={initial.test_event_code} placeholder="TEST12345" />
          </div>
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="tt-token">Access token de Events API {tokenConfigured ? <span className="font-normal text-emerald-600">· configurado</span> : null}</Label>
            <Input id="tt-token" name="token" type="password" autoComplete="off" placeholder={tokenConfigured ? "Déjalo vacío para mantener el actual" : "Pégalo desde TikTok Events Manager"} />
            {tokenConfigured ? (
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input type="checkbox" name="clear_token" className="size-3.5" /> Borrar el token guardado
              </label>
            ) : null}
          </div>
          <div className="flex flex-col gap-2 text-sm sm:col-span-2">
            <label className="flex items-center gap-2">
              <input type="checkbox" name="enabled" defaultChecked={initial.enabled} className="size-4" /> Activar TikTok en mis landings
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="send_lead" defaultChecked={initial.send_lead} className="size-4" /> Enviar SubmitForm (pedido)
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="send_purchase" defaultChecked={initial.send_purchase} className="size-4" /> Enviar CompletePayment (venta real)
            </label>
          </div>
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label>Plantilla de URL para tus anuncios de TikTok</Label>
            <div className="flex gap-2">
              <code className="min-w-0 flex-1 rounded-md bg-muted p-2 text-xs break-all">{TIKTOK_URL_TEMPLATE}</code>
              <Button
                type="button"
                size="icon-sm"
                variant="outline"
                aria-label="Copiar plantilla"
                onClick={() => {
                  void navigator.clipboard.writeText(TIKTOK_URL_TEMPLATE);
                  toast.success("Plantilla copiada");
                }}
              >
                <Copy />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">Pégala en TikTok Ads → Anuncio → Parámetros de URL. Así cada pedido queda atado a su campaña y anuncio.</p>
          </div>
          <div className="flex justify-end sm:col-span-2">
            <Button type="submit" disabled={pending}>
              {pending ? "Guardando…" : "Guardar TikTok"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
