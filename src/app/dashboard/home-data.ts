/**
 * Cálculos del Inicio que no dependen del filtro de fechas: lo pendiente «ahora» y la guía
 * para preparar la tienda. Funciones puras para poder probarlas sin base de datos.
 */

const DAY = 86_400_000;

/** Días que un pedido puede esperar en la agencia antes de avisar. */
export const AGENCY_WAIT_DAYS = 3;

/** Instante límite: lo que llegó a la agencia antes de esto ya lleva más de 3 días ahí. */
export function agencyCutoff(now = new Date()): string {
  return new Date(now.getTime() - AGENCY_WAIT_DAYS * DAY).toISOString();
}

type Delivered = { balance_due: number | string | null; shipping_cost: number | string | null };
type Failed = { shipping_cost: number | string | null; return_shipments: number | null };

/**
 * Lo que te deben los couriers de Lima: lo cobrado menos sus envíos, y también el envío de los
 * fallidos (igual que en Liquidación, para que las dos cifras siempre coincidan).
 */
export function limaCourierDebt(delivered: Delivered[], failed: Failed[]): number {
  const net = delivered.reduce((s, o) => s + Number(o.balance_due ?? 0) - Number(o.shipping_cost ?? 0), 0);
  const failedCost = failed.reduce((s, o) => s + Number(o.shipping_cost ?? 0) * (o.return_shipments ?? 1), 0);
  return Math.round((net - failedCost) * 100) / 100;
}

export type TodayKey = "confirmar" | "despachar" | "liquidar" | "agencia" | "abandonados";
export type TodayItem = { key: TodayKey; href: string; count: number; amount?: number };

/** Lo que toca hoy: solo lo que tiene algo pendiente, en el orden en que conviene atenderlo. */
export function buildTodayItems(input: {
  counts: Record<string, unknown> | null | undefined;
  limaDebt: number;
  agencyStale: number | null | undefined;
  abandonedToday: number | null | undefined;
}): TodayItem[] {
  const c = input.counts ?? {};
  const n = (v: unknown) => {
    const x = Number(v ?? 0);
    return Number.isFinite(x) ? x : 0;
  };
  const items: TodayItem[] = [
    { key: "confirmar", href: "/dashboard/logistica?vista=confirmar", count: n(c.confirmar) },
    { key: "despachar", href: "/dashboard/logistica?vista=despachar", count: n(c.despachar) },
    { key: "liquidar", href: "/dashboard/liquidacion", count: input.limaDebt > 0 ? 1 : 0, amount: input.limaDebt },
    { key: "agencia", href: "/dashboard/logistica?vista=en-camino&zona=provincia", count: n(input.agencyStale) },
    { key: "abandonados", href: "/dashboard/abandonados", count: n(input.abandonedToday) },
  ];
  return items.filter((i) => i.count > 0);
}

export type SetupKey = "meta" | "whatsapp" | "product" | "landing" | "order";
export type SetupStep = { key: SetupKey; title: string; text: string; href: string; done: boolean };

/** Prepara tu tienda: 5 pasos con lo que la tienda ya hizo. */
export function buildSetupSteps(input: {
  metaConnected: boolean;
  whatsapp: string | null | undefined;
  products: number | null | undefined;
  publishedLandings: number | null | undefined;
  hasOrders: boolean;
}): SetupStep[] {
  return [
    { key: "meta", title: "Conecta Meta", text: "Para ver tu gasto y tu ROAS real.", href: "/dashboard/marketing", done: input.metaConnected },
    { key: "whatsapp", title: "Pon tu WhatsApp", text: "Para que tus clientes te escriban.", href: "/dashboard/configuracion", done: Boolean(input.whatsapp?.trim()) },
    { key: "product", title: "Crea un producto", text: "Con fotos, costo y sus ofertas.", href: "/dashboard/productos/nuevo", done: (input.products ?? 0) > 0 },
    { key: "landing", title: "Publica una landing", text: "Elige una plantilla y publícala.", href: "/dashboard/landings", done: (input.publishedLandings ?? 0) > 0 },
    { key: "order", title: "Recibe tu primer pedido", text: "Pega el link de tu landing en tu anuncio.", href: "/dashboard/landings", done: input.hasOrders },
  ];
}
