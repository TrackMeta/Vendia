/**
 * Máquina de estados del pedido.
 * ESPEJO de public.order_transition_allowed() en
 * supabase/migrations/20261008000300_functions.sql — la base de datos es la autoridad;
 * esto solo sirve para mostrar en la UI qué cambios son posibles.
 */
export const ORDER_STATUSES = [
  "new",
  "pending_confirmation",
  "confirmed",
  "preparing",
  "shipped",
  "out_for_delivery",
  "delivered",
  "collected",
  "cancelled",
  "failed_delivery",
  "returned",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  new: "Nuevo",
  pending_confirmation: "Por confirmar",
  confirmed: "Confirmado",
  preparing: "Preparando",
  shipped: "Enviado",
  out_for_delivery: "En reparto",
  delivered: "Entregado",
  collected: "Cobrado",
  cancelled: "Cancelado",
  failed_delivery: "No entregado",
  returned: "Devuelto",
};

export type StatusTone = "neutral" | "info" | "progress" | "success" | "danger";

export const ORDER_STATUS_TONE: Record<OrderStatus, StatusTone> = {
  new: "info",
  pending_confirmation: "info",
  confirmed: "progress",
  preparing: "progress",
  shipped: "progress",
  out_for_delivery: "progress",
  delivered: "success",
  collected: "success",
  cancelled: "danger",
  failed_delivery: "danger",
  returned: "danger",
};

const MAIN_CHAIN: OrderStatus[] = [
  "new",
  "pending_confirmation",
  "confirmed",
  "preparing",
  "shipped",
  "out_for_delivery",
  "delivered",
  "collected",
];

function rank(status: OrderStatus): number | null {
  const index = MAIN_CHAIN.indexOf(status);
  return index === -1 ? null : index;
}

export function isTransitionAllowed(from: OrderStatus, to: OrderStatus): boolean {
  if (from === to) return false;
  const fromRank = rank(from);
  const toRank = rank(to);
  if (fromRank !== null && toRank !== null) return toRank > fromRank;
  if (to === "cancelled") return ["new", "pending_confirmation", "confirmed", "preparing"].includes(from);
  if (to === "failed_delivery") return from === "shipped" || from === "out_for_delivery";
  if (to === "returned") return from === "failed_delivery";
  if (from === "cancelled") return to === "new" || to === "pending_confirmation";
  return false;
}

export function allowedTransitions(from: OrderStatus): OrderStatus[] {
  return ORDER_STATUSES.filter((to) => isTransitionAllowed(from, to));
}

/** El siguiente paso "natural" (botón principal en la UI). */
export function nextStatus(from: OrderStatus): OrderStatus | null {
  const r = rank(from);
  if (r === null || r === MAIN_CHAIN.length - 1) return null;
  return MAIN_CHAIN[r + 1];
}
