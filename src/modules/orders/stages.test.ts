import { describe, expect, it } from "vitest";
import { ORDER_STAGES, parseStage, stageCounts, stageOf } from "./stages";
import { ORDER_STATUSES } from "./state-machine";

describe("Etapas de Pedidos", () => {
  it("cada estado está en una sola etapa", () => {
    const all = Object.values(ORDER_STAGES).flatMap((s) => s.statuses as readonly string[]);
    expect([...all].sort()).toEqual([...ORDER_STATUSES].sort());
    expect(new Set(all).size).toBe(all.length);
  });

  it("agrupa los contadores", () => {
    const counts = stageCounts(new Map([["new", 2], ["pending_confirmation", 1], ["at_agency", 3], ["collected", 1], ["returned", 1]]));
    expect(counts).toEqual({ confirmar: 3, despachar: 0, camino: 3, entregados: 1, problemas: 1 });
  });

  it("lee la etapa del link", () => {
    expect(parseStage("camino")).toBe("camino");
    expect(parseStage("otra")).toBeNull();
    expect(stageOf("preparing")).toBe("despachar");
  });
});
