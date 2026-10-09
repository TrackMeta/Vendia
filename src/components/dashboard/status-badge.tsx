import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { ORDER_STATUS_LABELS, ORDER_STATUS_TONE, type OrderStatus, type StatusTone } from "@/modules/orders/state-machine";

/** Colores de estado: nunca el rojo de la marca (ese es para acciones). Solo «danger» (pérdida) va en rojo claro. */
const TONE_CLASS: Record<StatusTone, string> = {
  neutral: "bg-muted text-muted-foreground",
  info: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200",
  attention: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
  progress: "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200",
  transit: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200",
  success: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  cancelled: "bg-muted text-muted-foreground",
  danger: "bg-red-50 text-red-700 ring-1 ring-red-200 ring-inset dark:bg-red-950 dark:text-red-200 dark:ring-red-900",
};

const BASE = "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap";

export function OrderStatusBadge({ status, className }: { status: OrderStatus; className?: string }) {
  const tone = ORDER_STATUS_TONE[status];
  return (
    <span className={cn(BASE, TONE_CLASS[tone], className)}>
      {tone === "cancelled" ? <X className="size-3" aria-hidden /> : null}
      {ORDER_STATUS_LABELS[status]}
    </span>
  );
}

export function SimpleBadge({ tone = "neutral", children }: { tone?: StatusTone; children: React.ReactNode }) {
  return <span className={cn(BASE, TONE_CLASS[tone])}>{children}</span>;
}
