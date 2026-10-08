import { cn } from "@/lib/utils";
import { ORDER_STATUS_LABELS, ORDER_STATUS_TONE, type OrderStatus } from "@/modules/orders/state-machine";

const TONE_CLASS = {
  neutral: "bg-muted text-muted-foreground",
  info: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200",
  progress: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
  success: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  danger: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
} as const;

export function OrderStatusBadge({ status, className }: { status: OrderStatus; className?: string }) {
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap", TONE_CLASS[ORDER_STATUS_TONE[status]], className)}>
      {ORDER_STATUS_LABELS[status]}
    </span>
  );
}

export function SimpleBadge({ tone = "neutral", children }: { tone?: keyof typeof TONE_CLASS; children: React.ReactNode }) {
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap", TONE_CLASS[tone])}>
      {children}
    </span>
  );
}
