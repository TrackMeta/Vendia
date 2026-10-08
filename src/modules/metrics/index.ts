/**
 * ÚNICO lugar donde se calculan las métricas financieras de Vendia.
 * Ninguna página debe calcular CPA/ROAS/utilidad por su cuenta.
 *
 * Cohorte: los conteos corresponden a pedidos CREADOS en el rango de fechas;
 * el gasto publicitario es el gasto de ese mismo rango.
 */

export type OrderCounts = {
  orders: number;
  /** Suma del total de TODOS los pedidos generados (no es venta). */
  ordersValue: number;
  confirmed: number;
  shipped: number;
  delivered: number;
  collected: number;
  cancelled: number;
  failed: number;
  inProgress: number;
};

export type MoneyTotals = {
  /** Revenue cobrado: total de pedidos entregados. */
  revenue: number;
  /** Costo de producto de los pedidos entregados. */
  productCost: number;
  /** Costo de envío de todos los pedidos que salieron (incluye no entregados). */
  shippingCost: number;
  /** Gasto publicitario (Meta, TikTok, Google). */
  adSpend: number;
  /** Otros gastos del periodo. */
  otherExpenses: number;
};

/** División segura: devuelve null si no hay divisor (se muestra "—"). */
export function safeDivide(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return null;
  return numerator / denominator;
}

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function computeCpa(adSpend: number, counts: Pick<OrderCounts, "orders" | "confirmed" | "shipped" | "delivered">) {
  return {
    /** Gasto / pedidos generados */
    perOrder: safeDivide(adSpend, counts.orders),
    /** Gasto / pedidos confirmados */
    perConfirmed: safeDivide(adSpend, counts.confirmed),
    /** Gasto / pedidos enviados */
    perShipped: safeDivide(adSpend, counts.shipped),
    /** Gasto / pedidos entregados — la métrica principal de rentabilidad */
    perDelivered: safeDivide(adSpend, counts.delivered),
  };
}

export function computeRoas(adSpend: number, ordersValue: number, revenue: number) {
  return {
    /** Valor de pedidos generados / gasto (engañoso en COD) */
    orders: safeDivide(ordersValue, adSpend),
    /** Revenue cobrado / gasto */
    real: safeDivide(revenue, adSpend),
  };
}

export function computeProfit(totals: MoneyTotals) {
  const profit =
    totals.revenue - totals.productCost - totals.shippingCost - totals.adSpend - totals.otherExpenses;
  return {
    profit: round2(profit),
    margin: safeDivide(profit, totals.revenue),
  };
}

export function computeRates(counts: OrderCounts) {
  return {
    confirmationRate: safeDivide(counts.confirmed, counts.orders),
    shippingRate: safeDivide(counts.shipped, counts.confirmed),
    /** Entregados / enviados */
    deliveryRate: safeDivide(counts.delivered, counts.shipped),
    /** Entregados / pedidos generados */
    effectiveRate: safeDivide(counts.delivered, counts.orders),
    cancellationRate: safeDivide(counts.cancelled, counts.orders),
  };
}

export type DashboardMetrics = ReturnType<typeof computeDashboardMetrics>;

export function computeDashboardMetrics(counts: OrderCounts, totals: MoneyTotals) {
  return {
    counts,
    totals,
    cpa: computeCpa(totals.adSpend, counts),
    roas: computeRoas(totals.adSpend, counts.ordersValue, totals.revenue),
    ...computeProfit(totals),
    rates: computeRates(counts),
  };
}

/** Convierte la respuesta de public.get_order_stats() al formato del módulo. */
export function fromOrderStats(row: Record<string, number | string>): { counts: OrderCounts; revenue: number; productCost: number; shippingCost: number } {
  const n = (key: string) => Number(row[key] ?? 0);
  return {
    counts: {
      orders: n("orders"),
      ordersValue: n("orders_value"),
      confirmed: n("confirmed"),
      shipped: n("shipped"),
      delivered: n("delivered"),
      collected: n("collected"),
      cancelled: n("cancelled"),
      failed: n("failed"),
      inProgress: n("in_progress"),
    },
    revenue: n("revenue"),
    productCost: n("product_cost"),
    shippingCost: n("shipping_cost"),
  };
}
