import { describe, expect, it } from "vitest";
import { buildFunnel, computeCpa, computeDashboardMetrics, computeProfit, computeRoas, computeRowMetrics, safeDivide } from ".";

describe("CPA", () => {
  it("CPA pedido: S/100 / 20 pedidos = S/5", () => {
    expect(computeCpa(100, { orders: 20, confirmed: 15, shipped: 12, delivered: 9 }).perOrder).toBe(5);
  });

  it("CPA entregado: S/100 / 9 entregados = S/11.11", () => {
    const cpa = computeCpa(100, { orders: 20, confirmed: 15, shipped: 12, delivered: 9 });
    expect(cpa.perDelivered).toBeCloseTo(11.11, 2);
    expect(cpa.perConfirmed).toBeCloseTo(6.67, 2);
    expect(cpa.perShipped).toBeCloseTo(8.33, 2);
  });

  it("sin pedidos no inventa un CPA (null → se muestra '—')", () => {
    const cpa = computeCpa(100, { orders: 0, confirmed: 0, shipped: 0, delivered: 0 });
    expect(cpa.perOrder).toBeNull();
    expect(cpa.perDelivered).toBeNull();
  });

  it("campaña B con menos pedidos pero más entregas tiene mejor CPA real que A", () => {
    const a = computeCpa(300, { orders: 50, confirmed: 25, shipped: 18, delivered: 12 });
    const b = computeCpa(300, { orders: 20, confirmed: 18, shipped: 16, delivered: 15 });
    expect(a.perOrder!).toBeLessThan(b.perOrder!);
    expect(b.perDelivered!).toBeLessThan(a.perDelivered!);
  });
});

describe("Utilidad real", () => {
  it("ejemplo del documento: 7110 − 2700 − 900 − 1000 − 100 = 2410", () => {
    const result = computeProfit({
      revenue: 7110,
      productCost: 2700,
      shippingCost: 900,
      adSpend: 1000,
      otherExpenses: 100,
    });
    expect(result.profit).toBe(2410);
    expect(result.margin).toBeCloseTo(2410 / 7110, 6);
  });

  it("margen null cuando no hay revenue", () => {
    expect(computeProfit({ revenue: 0, productCost: 0, shippingCost: 50, adSpend: 100, otherExpenses: 0 })).toEqual({
      profit: -150,
      margin: null,
    });
  });

  it("no tiene errores de punto flotante", () => {
    expect(computeProfit({ revenue: 0.3, productCost: 0.1, shippingCost: 0.2, adSpend: 0, otherExpenses: 0 }).profit).toBe(0);
  });
});

describe("ROAS", () => {
  it("distingue ROAS de pedidos y ROAS real", () => {
    const roas = computeRoas(1000, 8900, 7110);
    expect(roas.orders).toBeCloseTo(8.9);
    expect(roas.real).toBeCloseTo(7.11);
  });

  it("sin gasto no hay ROAS", () => {
    expect(computeRoas(0, 100, 100)).toEqual({ orders: null, real: null });
  });
});

describe("Dashboard", () => {
  it("combina todo y calcula tasas", () => {
    const m = computeDashboardMetrics(
      { orders: 80, ordersValue: 7120, confirmed: 60, shipped: 54, delivered: 43, collected: 40, cancelled: 15, failed: 11, inProgress: 0 },
      { revenue: 3827, productCost: 1290, shippingCost: 540, adSpend: 1000, otherExpenses: 0 },
    );
    expect(m.cpa.perDelivered).toBeCloseTo(23.26, 2);
    expect(m.rates.confirmationRate).toBe(0.75);
    expect(m.rates.deliveryRate).toBeCloseTo(43 / 54);
    expect(m.profit).toBe(997);
  });

  it("safeDivide rechaza infinitos", () => {
    expect(safeDivide(1, 0)).toBeNull();
    expect(safeDivide(Number.NaN, 1)).toBeNull();
  });
});


describe("Métricas por fila (campañas, productos, geografía)", () => {
  it("calcula CPA entregado, ROAS real y utilidad de una campaña", () => {
    const m = computeRowMetrics({ orders: 20, confirmed: 18, shipped: 16, delivered: 15, orders_value: 1800, revenue: 1350, product_cost: 375, shipping_cost: 160, ad_spend: 300 });
    expect(m.cpa.perOrder).toBe(15);
    expect(m.cpa.perDelivered).toBe(20);
    expect(m.roas.real).toBe(4.5);
    expect(m.profit).toBe(515);
    expect(m.deliveryRate).toBeCloseTo(15 / 16);
  });

  it("acepta números como texto (numeric de Postgres)", () => {
    expect(computeRowMetrics({ orders: "2", revenue: "89.90", product_cost: "22", shipping_cost: "0", confirmed: 0, shipped: 0, delivered: 1 }).profit).toBe(67.9);
  });
});

describe("Funnel", () => {
  it("calcula la conversión entre cada etapa (ejemplo del documento)", () => {
    const f = buildFunnel({ visits: 10000, view_content: 10000, initiate_checkout: 800, orders: 80, confirmed: 60, shipped: 54, delivered: 43, collected: 40 });
    expect(f[2].rateFromPrevious).toBe(0.08);
    expect(f[3].rateFromPrevious).toBe(0.1);
    expect(f[4].rateFromPrevious).toBe(0.75);
    expect(f[5].rateFromPrevious).toBe(0.9);
    expect(f[6].rateFromPrevious).toBeCloseTo(0.796, 3);
    expect(f[0].rateFromPrevious).toBeNull();
  });
});

describe("Rendimiento: Meta + Vendia", () => {
  it("pone el costo por resultado de Meta junto al CPA real", async () => {
    const { computePerformanceRow } = await import("./index");
    const r = computePerformanceRow({ ad_spend: 300, impressions: 60000, clicks: 600, results: 30, orders: 25, confirmed: 20, shipped: 18, delivered: 12, revenue: 1200, product_cost: 300, shipping_cost: 180 });
    expect(r.costPerResult).toBe(10); // lo que dice Meta
    expect(r.cpa.perDelivered).toBe(25); // lo que de verdad cuesta cada venta
    expect(r.cpm).toBe(5);
    expect(r.ctr).toBe(0.01);
    expect(r.cpc).toBe(0.5);
    expect(r.confirmationRate).toBe(0.8);
    expect(r.profit).toBe(1200 - 300 - 180 - 300);
  });
  it("sin impresiones ni resultados muestra «—» (null), no 0 ni infinito", async () => {
    const { computePerformanceRow } = await import("./index");
    const r = computePerformanceRow({ orders: 3 });
    expect([r.cpm, r.ctr, r.costPerResult, r.cpa.perDelivered]).toEqual([null, null, null, null]);
  });
});
