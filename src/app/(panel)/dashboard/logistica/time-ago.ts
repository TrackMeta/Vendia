import { formatDateTime } from "@/lib/format";

/** Hace cuánto entró el pedido («hace 5 min», «hace 3 h», «hace 2 d»); si pasó una semana, la fecha. */
export function timeAgo(iso: string, now = Date.now()): string {
  const min = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000));
  if (min < 1) return "ahora";
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return d < 7 ? `hace ${d} d` : formatDateTime(iso);
}
