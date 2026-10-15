"use client";

import { CheckCircle2, Clock, Loader2, MinusCircle, RotateCcw, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { BrandIcon } from "@/components/brand-icons";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { retryOrderEvents } from "./ads-actions";

export type AdsEventRow = { platform: "meta" | "tiktok"; event_name: string; status: "pending" | "sent" | "failed" | "skipped"; last_error: string | null; sent_at: string | null; created_at: string };

const KIND: Record<string, "pedido" | "venta"> = { Lead: "pedido", SubmitForm: "pedido", Purchase: "venta", CompletePayment: "venta" };

const STATUS = {
  sent: { label: "Enviado", icon: CheckCircle2, tone: "text-emerald-600 dark:text-emerald-400" },
  pending: { label: "En cola", icon: Clock, tone: "text-amber-600 dark:text-amber-400" },
  failed: { label: "Falló", icon: XCircle, tone: "text-destructive" },
  skipped: { label: "No se envió", icon: XCircle, tone: "text-destructive" },
} as const;

/**
 * Detalle del pedido → «Anuncios»: si Meta (y TikTok) recibieron el pedido (Lead) y la venta (Purchase).
 * Solo el dueño. Con «Reintentar» se vuelve a enviar lo que no llegó.
 */
export function AdsEventsCard({
  orderId,
  rows,
  fromLanding,
  isSale,
  tiktok,
}: {
  orderId: string;
  rows: AdsEventRow[];
  fromLanding: boolean;
  isSale: boolean;
  tiktok: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const find = (platform: "meta" | "tiktok", kind: "pedido" | "venta") => rows.find((r) => r.platform === platform && KIND[r.event_name] === kind);
  const platforms: ("meta" | "tiktok")[] = tiktok || rows.some((r) => r.platform === "tiktok") ? ["meta", "tiktok"] : ["meta"];

  // Qué falta: un evento que falló, o uno que debió registrarse y no está
  const missing = (platform: "meta" | "tiktok", kind: "pedido" | "venta") => !find(platform, kind) && (kind === "pedido" ? fromLanding : isSale);
  const canRetry = rows.some((r) => r.status === "failed" || r.status === "skipped" || r.status === "pending") || missing("meta", "pedido") || missing("meta", "venta");

  const retry = () =>
    startTransition(async () => {
      const r = await retryOrderEvents(orderId);
      if (r.ok) toast.success(r.message);
      else toast.error(r.error);
      router.refresh();
    });

  const line = (platform: "meta" | "tiktok", kind: "pedido" | "venta") => {
    const row = find(platform, kind);
    const title = kind === "pedido" ? "Pedido" : "Venta";
    const tech = platform === "meta" ? (kind === "pedido" ? "Lead" : "Purchase") : kind === "pedido" ? "SubmitForm" : "CompletePayment";
    let status: { label: string; icon: typeof CheckCircle2; tone: string };
    let detail: string | null = null;
    if (row) {
      status = STATUS[row.status];
      if (row.status === "sent" && row.sent_at) detail = formatDateTime(row.sent_at);
      else if (row.status !== "sent") detail = row.last_error;
    } else if (kind === "pedido" && !fromLanding) {
      status = { label: "No aplica", icon: MinusCircle, tone: "text-muted-foreground" };
      detail = "El pedido no vino de una landing";
    } else if (kind === "venta" && !isSale) {
      status = { label: "Todavía no", icon: Clock, tone: "text-muted-foreground" };
      detail = "Se envía cuando el pedido sea una venta real";
    } else {
      status = { label: "No se registró", icon: XCircle, tone: "text-destructive" };
      detail = platform === "meta" ? "¿Meta no estaba conectado en ese momento?" : "¿TikTok no estaba conectado en ese momento?";
    }
    const Icon = status.icon;
    return (
      <li key={`${platform}-${kind}`} className="flex items-start justify-between gap-3 py-2 text-sm">
        <span className="flex min-w-0 flex-col">
          <span className="font-medium">
            {title} <span className="text-xs font-normal text-muted-foreground">({tech})</span>
          </span>
          {detail ? <span className="text-xs break-words text-muted-foreground">{detail}</span> : null}
        </span>
        <span className={cn("flex shrink-0 items-center gap-1 text-xs font-medium", status.tone)}>
          <Icon className="size-3.5" aria-hidden /> {status.label}
        </span>
      </li>
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Anuncios</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {platforms.map((p) => (
          <div key={p} className="flex flex-col">
            <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <BrandIcon name={p} className="size-3.5" /> {p === "meta" ? "Meta" : "TikTok"}
            </p>
            <ul className="divide-y">
              {line(p, "pedido")}
              {line(p, "venta")}
            </ul>
          </div>
        ))}
        {canRetry ? (
          <Button type="button" variant="outline" size="sm" className="w-fit" onClick={retry} disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : <RotateCcw />} Reintentar
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
