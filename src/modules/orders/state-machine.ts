/**
 * Máquina de estados del pedido.
 * ESPEJO de public.order_transition_allowed(from, to, zone) en
 * supabase/migrations/20261008001300_provincia_despacho.sql — la base de datos es la autoridad;
 * esto solo sirve para mostrar en la UI qué cambios son posibles.
 *
 * Lima:      … → Enviado → En reparto → Entregado → Cobrado
 * Provincia: … → Enviado → En agencia → Cobrado (pagó el saldo) → Entregado (recogió)
 */
export const ORDER_STATUSES = [
  "new",
  "pending_confirmation",
  "confirmed",
  "preparing",
  "shipped",
  "out_for_delivery",
  "at_agency",
  "delivered",
  "collected",
  "cancelled",
  "failed_delivery",
  "returned",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];
export type Zone = "lima" | "provincia";

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  new: "Nuevo",
  pending_confirmation: "Por confirmar",
  confirmed: "Confirmado",
  preparing: "Preparando",
  shipped: "Enviado",
  out_for_delivery: "En reparto",
  at_agency: "En agencia",
  delivered: "Entregado",
  collected: "Cobrado",
  cancelled: "Cancelado",
  failed_delivery: "No entregado",
  returned: "Devuelto",
};

/**
 * attention: falta que alguien actúe (confirmar) · progress: confirmado/preparando · transit: en camino
 * success: venta · cancelled: anulado (normal en contraentrega, no es alarma) · danger: pérdida (no entregado/devuelto)
 */
export type StatusTone = "neutral" | "info" | "attention" | "progress" | "transit" | "success" | "cancelled" | "danger";

export const ORDER_STATUS_TONE: Record<OrderStatus, StatusTone> = {
  new: "attention",
  pending_confirmation: "attention",
  confirmed: "progress",
  preparing: "progress",
  shipped: "transit",
  out_for_delivery: "transit",
  at_agency: "transit",
  delivered: "success",
  collected: "success",
  cancelled: "cancelled",
  failed_delivery: "danger",
  returned: "danger",
};

const CHAINS: Record<Zone, OrderStatus[]> = {
  lima: ["new", "pending_confirmation", "confirmed", "preparing", "shipped", "out_for_delivery", "delivered", "collected"],
  provincia: ["new", "pending_confirmation", "confirmed", "preparing", "shipped", "at_agency", "collected", "delivered"],
};

function rank(status: OrderStatus, zone: Zone): number | null {
  const index = CHAINS[zone].indexOf(status);
  return index === -1 ? null : index;
}

export function isTransitionAllowed(from: OrderStatus, to: OrderStatus, zone: Zone = "lima"): boolean {
  if (from === to) return false;
  const fromRank = rank(from, zone);
  const toRank = rank(to, zone);
  if (fromRank !== null && toRank !== null) return toRank > fromRank;
  if (to === "cancelled") return ["new", "pending_confirmation", "confirmed", "preparing"].includes(from);
  if (to === "failed_delivery") return from === "shipped" || from === "out_for_delivery" || from === "at_agency";
  if (to === "returned") return from === "failed_delivery";
  if (from === "cancelled") return to === "new" || to === "pending_confirmation";
  return false;
}

export function allowedTransitions(from: OrderStatus, zone: Zone = "lima"): OrderStatus[] {
  return ORDER_STATUSES.filter((to) => isTransitionAllowed(from, to, zone));
}

/** El siguiente paso "natural" (botón principal en la UI). */
export function nextStatus(from: OrderStatus, zone: Zone = "lima"): OrderStatus | null {
  const chain = CHAINS[zone];
  const r = rank(from, zone);
  if (r === null || r === chain.length - 1) return null;
  return chain[r + 1];
}

/** Estados que significan «el pedido ya salió y está en camino». */
export const IN_TRANSIT_STATUSES: OrderStatus[] = ["shipped", "out_for_delivery", "at_agency"];
