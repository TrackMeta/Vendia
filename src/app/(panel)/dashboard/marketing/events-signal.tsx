"use client";

import { Copy, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { RetryButton } from "./meta-forms";

export type EventsStatus = { lastSentAt: string | null; failed: number };

/** Una semana sin eventos enviados = algo no está llegando (o no hubo pedidos). */
const RECENT_MS = 7 * 24 * 3600_000;

function isRecent(iso: string): boolean {
  return Date.now() - Date.parse(iso) < RECENT_MS;
}

/**
 * Señal de una sola línea: ¿la plataforma está recibiendo los eventos de Vendia?
 * Reemplaza a la tabla de eventos: solo importa saber si funciona y, si algo falló, reintentarlo.
 */
export function EventsSignal({ status, enabled }: { status: EventsStatus; enabled: boolean }) {
  if (status.failed > 0) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
        <TriangleAlert className="size-4 shrink-0" />
        <span className="flex-1">
          {status.failed === 1 ? "1 evento no se pudo enviar." : `${status.failed} eventos no se pudieron enviar.`} Revisa tu token o tu Pixel.
        </span>
        <RetryButton count={status.failed} />
      </div>
    );
  }
  const live = Boolean(status.lastSentAt && isRecent(status.lastSentAt));
  return (
    <p className="flex items-center gap-2 text-sm">
      <span className={cn("size-2.5 shrink-0 rounded-full", live ? "bg-emerald-500" : "bg-muted-foreground/40")} aria-hidden />
      {live ? (
        <span>
          Recibiendo eventos <span className="text-muted-foreground">· último {formatDateTime(status.lastSentAt!)}</span>
        </span>
      ) : (
        <span className="text-muted-foreground">
          {enabled ? "Activo. Aún sin eventos esta semana: aparecerán cuando lleguen pedidos." : "Sin eventos: actívalo para que reciba tus pedidos y ventas."}
        </span>
      )}
    </p>
  );
}

/** Plantilla de parámetros de URL, desplegable (se pega una vez por anuncio). */
export function UrlTemplateDetails({ template, where }: { template: string; where: string }) {
  return (
    <details className="group rounded-lg border">
      <summary className="cursor-pointer list-none px-3 py-2.5 text-sm font-medium marker:hidden">
        <span className="mr-1 inline-block transition-transform group-open:rotate-90">›</span> Plantilla de URL para tus anuncios
      </summary>
      <div className="flex flex-col gap-2 border-t px-3 py-3">
        <p className="text-xs text-muted-foreground">Pégala en {where}. Así cada pedido queda atado a su campaña y anuncio.</p>
        <code className="block rounded-md bg-muted p-3 text-xs break-all">{template}</code>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-fit"
          onClick={() => {
            void navigator.clipboard.writeText(template);
            toast.success("Plantilla copiada");
          }}
        >
          <Copy /> Copiar
        </Button>
      </div>
    </details>
  );
}
