import { ORDER_STATUSES, type OrderStatus } from "./state-machine";

/**
 * Etapas de la lista de Pedidos: agrupan los 12 estados en 5 pasos del trabajo diario
 * (las mismas ideas que las bandejas de Logística). El estado exacto se elige aparte.
 */
export const ORDER_STAGES = {
  confirmar: { label: "Por confirmar", statuses: ["new", "pending_confirmation"] },
  despachar: { label: "Por despachar", statuses: ["confirmed", "preparing"] },
  camino: { label: "En camino", statuses: ["shipped", "out_for_delivery", "at_agency"] },
  entregados: { label: "Entregados", statuses: ["delivered", "collected"] },
  problemas: { label: "Con problema", statuses: ["cancelled", "failed_delivery", "returned"] },
} as const satisfies Record<string, { label: string; statuses: readonly OrderStatus[] }>;

export type OrderStage = keyof typeof ORDER_STAGES;
export const ORDER_STAGE_KEYS = Object.keys(ORDER_STAGES) as OrderStage[];

export function parseStage(value: unknown): OrderStage | null {
  return typeof value === "string" && value in ORDER_STAGES ? (value as OrderStage) : null;
}

/** Etapa a la que pertenece un estado. */
export function stageOf(status: OrderStatus): OrderStage {
  return ORDER_STAGE_KEYS.find((k) => (ORDER_STAGES[k].statuses as readonly OrderStatus[]).includes(status))!;
}

/** Pedidos por etapa a partir de los contadores por estado. */
export function stageCounts(byStatus: Map<string, number>): Record<OrderStage, number> {
  const out = Object.fromEntries(ORDER_STAGE_KEYS.map((k) => [k, 0])) as Record<OrderStage, number>;
  for (const s of ORDER_STATUSES) out[stageOf(s)] += byStatus.get(s) ?? 0;
  return out;
}
