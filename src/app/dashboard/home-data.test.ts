import { describe, expect, it } from "vitest";
import { agencyCutoff, buildSetupSteps, buildTodayItems, limaCourierDebt } from "./home-data";

describe("limaCourierDebt", () => {
  it("resta los envíos de lo cobrado y descuenta los fallidos como en Liquidación", () => {
    const delivered = [
      { balance_due: "120.00", shipping_cost: "10.00" },
      { balance_due: 80, shipping_cost: 10 },
    ];
    const failed = [
      { shipping_cost: "10.00", return_shipments: 2 },
      { shipping_cost: 8, return_shipments: null },
    ];
    expect(limaCourierDebt(delivered, failed)).toBe(180 - 20 - 8);
  });

  it("sin pedidos no debe nada", () => {
    expect(limaCourierDebt([], [])).toBe(0);
  });
});

describe("agencyCutoff", () => {
  it("es 3 días antes de ahora", () => {
    expect(agencyCutoff(new Date("2026-10-13T12:00:00.000Z"))).toBe("2026-10-10T12:00:00.000Z");
  });
});

describe("buildTodayItems", () => {
  it("solo muestra lo que tiene pendientes, en orden", () => {
    const items = buildTodayItems({ counts: { confirmar: 5, despachar: 0, en_camino: 9 }, limaDebt: 450, agencyStale: 2, abandonedToday: null });
    expect(items.map((i) => i.key)).toEqual(["confirmar", "liquidar", "agencia"]);
    expect(items[0]).toMatchObject({ count: 5, href: "/dashboard/logistica?vista=confirmar" });
    expect(items[1]).toMatchObject({ amount: 450, href: "/dashboard/liquidacion" });
    expect(items[2].href).toBe("/dashboard/logistica?vista=en-camino&zona=provincia");
  });

  it("sin nada pendiente devuelve una lista vacía (Todo al día)", () => {
    expect(buildTodayItems({ counts: null, limaDebt: -15, agencyStale: 0, abandonedToday: 0 })).toEqual([]);
  });
});

describe("buildSetupSteps", () => {
  it("marca lo que la tienda ya hizo", () => {
    const steps = buildSetupSteps({ metaConnected: true, whatsapp: "  ", products: 2, publishedLandings: 0, hasOrders: false });
    expect(steps.map((s) => [s.key, s.done])).toEqual([
      ["meta", true],
      ["whatsapp", false],
      ["product", true],
      ["landing", false],
      ["order", false],
    ]);
  });
});
