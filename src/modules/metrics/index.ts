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
  /** Pedidos con campaña identificada (campaign_id o utm_campaign). */
  attributed?: number;
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
    /** % de pedidos que llegaron con su campaña: sin esto, el CPA por campaña no es confiable */
    attributionRate: safeDivide(counts.attributed ?? 0, counts.orders),
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
      attributed: n("attributed"),
    },
    revenue: n("revenue"),
    productCost: n("product_cost"),
    shippingCost: n("shipping_cost"),
  };
}

/** Fila de analítica (campaña, producto, departamento/provincia/distrito) tal como llega de SQL. */
export type StatsRow = {
  orders: number;
  confirmed: number;
  shipped: number;
  delivered: number;
  cancelled?: number;
  failed?: number;
  visits?: number;
  orders_value?: number;
  revenue: number;
  product_cost: number;
  shipping_cost: number;
  ad_spend?: number;
};

/** Métricas derivadas de una fila. Misma fórmula que el Inicio (sin otros gastos: se asignan solo al total). */
export function computeRowMetrics(raw: Record<string, unknown>) {
  const n = (k: string) => Number(raw[k] ?? 0);
  const row: StatsRow = {
    orders: n("orders"),
    confirmed: n("confirmed"),
    shipped: n("shipped"),
    delivered: n("delivered"),
    cancelled: n("cancelled"),
    failed: n("failed"),
    visits: n("visits"),
    orders_value: n("orders_value"),
    revenue: n("revenue"),
    product_cost: n("product_cost"),
    shipping_cost: n("shipping_cost"),
    ad_spend: n("ad_spend"),
  };
  const adSpend = row.ad_spend ?? 0;
  const { profit, margin } = computeProfit({
    revenue: row.revenue,
    productCost: row.product_cost,
    shippingCost: row.shipping_cost,
    adSpend,
    otherExpenses: 0,
  });
  return {
    ...row,
    cpa: computeCpa(adSpend, row),
    roas: computeRoas(adSpend, row.orders_value ?? 0, row.revenue),
    profit,
    margin,
    deliveryRate: safeDivide(row.delivered, row.shipped),
    effectiveRate: safeDivide(row.delivered, row.orders),
    cancellationRate: safeDivide(row.cancelled ?? 0, row.orders),
    conversionRate: safeDivide(row.orders, row.visits ?? 0),
  };
}

export type FunnelStep = { key: string; label: string; value: number; rateFromPrevious: number | null };

/** Funnel: Visitas → ViewContent → InitiateCheckout → Pedidos → Confirmados → Enviados → Entregados → Cobrados */
export function buildFunnel(raw: Record<string, unknown>): FunnelStep[] {
  const steps: [string, string][] = [
    ["visits", "Visitas"],
    ["view_content", "Vieron el producto"],
    ["initiate_checkout", "Abrieron el formulario"],
    ["orders", "Pedidos"],
    ["confirmed", "Confirmados"],
    ["shipped", "Enviados"],
    ["delivered", "Entregados"],
    ["collected", "Cobrados"],
  ];
  return steps.map(([key, label], i) => {
    const value = Number(raw[key] ?? 0);
    const previous = i > 0 ? Number(raw[steps[i - 1][0]] ?? 0) : null;
    return { key, label, value, rateFromPrevious: previous === null ? null : safeDivide(value, previous) };
  });
}

/**
 * Fila de Rendimiento: métricas de Meta (gasto, CPM, CTR, costo por resultado)
 * junto a las de Vendia (CPA real, ROAS real, utilidad). Mismas fórmulas que el Inicio.
 */
export function computePerformanceRow(raw: Record<string, unknown>) {
  const base = computeRowMetrics(raw);
  const n = (k: string) => Number(raw[k] ?? 0);
  const spend = base.ad_spend ?? 0;
  const impressions = n("impressions");
  const clicks = n("clicks");
  const results = n("results");
  return {
    ...base,
    impressions,
    reach: n("reach"),
    clicks,
    results,
    cpm: safeDivide(spend * 1000, impressions),
    ctr: safeDivide(clicks, impressions),
    cpc: safeDivide(spend, clicks),
    /** Costo por resultado según Meta (leads que Meta cuenta) */
    costPerResult: safeDivide(spend, results),
    confirmationRate: safeDivide(base.confirmed, base.orders),
  };
}

export type PerformanceRow = ReturnType<typeof computePerformanceRow>;
