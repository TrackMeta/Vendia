import { AlertTriangle } from "lucide-react";
import Link from "next/link";
import { SourceIcon } from "@/components/brand-icons";
import { OrderStatusBadge } from "@/components/dashboard/status-badge";
import { formatDateTime, formatMoney } from "@/lib/format";
import type { OrderStatus } from "@/modules/orders/state-machine";
import { ZoneBadge } from "../logistica/zone-badge";
import { timeAgo } from "../logistica/time-ago";

export type OrderCardData = {
  id: string;
  order_number: number;
  created_at: string;
  status: OrderStatus;
  zone: "lima" | "provincia";
  customer_name: string;
  total: number | string;
  district_name: string;
  province_name: string;
};

/** Pedido en el celular: una tarjeta que se toca entera para abrirlo. */
export function OrderCard({ order, risky, source, manual, product }: { order: OrderCardData; risky: boolean; source: string | null; manual: boolean; product: string }) {
  return (
    <Link
      href={`/dashboard/pedidos/${order.id}`}
      className="flex flex-col gap-2 rounded-xl bg-card p-3 ring-1 ring-foreground/10 transition-colors hover:bg-muted/40 active:bg-muted/60"
    >
      <span className="flex items-start justify-between gap-3">
        <span className="flex min-w-0 items-baseline gap-1.5">
          <span className="shrink-0 text-sm font-semibold tabular-nums">#{order.order_number}</span>
          {risky ? <AlertTriangle className="size-3.5 shrink-0 self-center text-amber-500" aria-label="Revisar: posible duplicado o riesgo" /> : null}
          <span className="truncate font-medium">{order.customer_name}</span>
        </span>
        <span className="shrink-0 font-semibold tabular-nums">{formatMoney(order.total)}</span>
      </span>
      <span className="flex flex-wrap items-center gap-1.5">
        <OrderStatusBadge status={order.status} />
        <ZoneBadge zone={order.zone} />
        <span className="ml-auto flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
          <SourceIcon source={source} />
          {manual && !source ? "Manual" : null}
          <time dateTime={order.created_at} title={formatDateTime(order.created_at)}>
            {timeAgo(order.created_at)}
          </time>
        </span>
      </span>
      <span className="truncate text-xs text-muted-foreground">
        {order.district_name}
        {order.province_name && order.province_name !== order.district_name ? `, ${order.province_name}` : ""}
        {product ? ` · ${product}` : ""}
      </span>
    </Link>
  );
}
