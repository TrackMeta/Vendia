/**
 * Venta real: cuándo un pedido deja de ser «pedido» y pasa a ser venta.
 * ESPEJO de public.order_is_sale() en supabase/migrations/20261008001400_numeros_correctos.sql
 * (las métricas se calculan en SQL; esto se usa para el Purchase de Meta y la UI).
 */
export const REAL_SALE_MODES = {
  zone: "Lima: Entregado · Provincia: Cobrado",
  delivered: "Entregado (Lima y provincia)",
} as const;

export type RealSaleMode = keyof typeof REAL_SALE_MODES;

export const parseSaleMode = (v: unknown): RealSaleMode => (v === "delivered" ? "delivered" : "zone");

type SaleOrder = { status: string; zone: string; delivered_at: string | null; collected_at: string | null };

export function isRealSale(order: SaleOrder, mode: RealSaleMode): boolean {
  if (order.status === "cancelled" || order.status === "failed_delivery" || order.status === "returned") return false;
  if (mode === "delivered" || order.zone === "lima") return Boolean(order.delivered_at);
  return Boolean(order.collected_at);
}

/** Estado que cuenta como venta en una zona («Entregado» o «Cobrado»). */
export function saleStatusLabel(zone: "lima" | "provincia", mode: RealSaleMode): string {
  return mode === "zone" && zone === "provincia" ? "Cobrado" : "Entregado";
}
