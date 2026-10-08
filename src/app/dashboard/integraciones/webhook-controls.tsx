"use client";

import { Copy, KeyRound } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { disableIntegration, enableGenericWebhook } from "./actions";

export function WebhookControls({ active, webhookUrl }: { active: boolean; webhookUrl: string }) {
  const [secret, setSecret] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const copy = (text: string, label: string) => {
    void navigator.clipboard.writeText(text);
    toast.success(`${label} copiado`);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <p className="font-medium">URL del webhook</p>
        <div className="flex items-center gap-2">
          <code className="flex-1 rounded-md bg-muted p-2 text-xs break-all">{webhookUrl}</code>
          <Button size="icon-sm" variant="outline" onClick={() => copy(webhookUrl, "URL")} aria-label="Copiar URL">
            <Copy />
          </Button>
        </div>
      </div>
      {secret ? (
        <div className="flex flex-col gap-1 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:bg-amber-950">
          <p className="font-medium text-amber-900 dark:text-amber-100">Secreto de firma — cópialo ahora, no se volverá a mostrar</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded bg-white/70 p-2 text-xs break-all dark:bg-black/30">{secret}</code>
            <Button size="icon-sm" variant="outline" onClick={() => copy(secret, "Secreto")} aria-label="Copiar secreto">
              <Copy />
            </Button>
          </div>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={pending}
          onClick={() => {
            if (active && !confirm("Se generará un secreto nuevo y el anterior dejará de funcionar. ¿Continuar?")) return;
            startTransition(async () => {
              const r = await enableGenericWebhook();
              if (r.ok) setSecret(r.secret);
              else toast.error(r.error);
            });
          }}
        >
          <KeyRound /> {active ? "Generar nuevo secreto" : "Activar webhook"}
        </Button>
        {active ? (
          <Button
            variant="outline"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const r = await disableIntegration("generic_webhook");
                if (r.ok) {
                  toast.success(r.message ?? "Desactivado");
                  setSecret(null);
                } else toast.error(r.error);
              })
            }
          >
            Desactivar
          </Button>
        ) : null}
      </div>
    </div>
  );
}
