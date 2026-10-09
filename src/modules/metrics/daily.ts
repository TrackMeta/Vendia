import { addDays, mondayOf } from "./date-range";

export type DailyRow = { day: string; orders: number; sales: number; revenue: number };
/** Un punto del gráfico: un día, una semana (desde el lunes) o un mes. */
export type SeriesPoint = DailyRow & { unit: "day" | "week" | "month" };

const MAX_DAYS = 62;
const MAX_WEEKS = 60;

function bucketKey(day: string, unit: SeriesPoint["unit"]): string {
  if (unit === "week") return mondayOf(day);
  if (unit === "month") return `${day.slice(0, 7)}-01`;
  return day;
}

function nextKey(key: string, unit: SeriesPoint["unit"]): string {
  if (unit === "day") return addDays(key, 1);
  if (unit === "week") return addDays(key, 7);
  const [y, m] = key.split("-").map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
}

/**
 * Serie para el gráfico del Inicio: rellena con ceros los días sin pedidos y, si el rango es largo,
 * agrupa por semana (más de 2 meses) o por mes (más de ~14 meses). En «Máximo» empieza en el
 * primer día con pedidos, para no dibujar años vacíos.
 */
export function buildSeries(rows: DailyRow[], startDate: string, endDate: string): SeriesPoint[] {
  const sorted = [...rows].filter((r) => r.day >= startDate && r.day <= endDate).sort((a, b) => a.day.localeCompare(b.day));
  const first = sorted.length && sorted[0].day > startDate && daysBetween(startDate, endDate) > MAX_DAYS ? sorted[0].day : startDate;
  const span = daysBetween(first, endDate) + 1;
  const unit: SeriesPoint["unit"] = span <= MAX_DAYS ? "day" : span <= MAX_WEEKS * 7 ? "week" : "month";

  const totals = new Map<string, DailyRow>();
  for (const r of sorted) {
    const key = bucketKey(r.day, unit);
    const acc = totals.get(key) ?? { day: key, orders: 0, sales: 0, revenue: 0 };
    acc.orders += Number(r.orders);
    acc.sales += Number(r.sales);
    acc.revenue += Number(r.revenue);
    totals.set(key, acc);
  }

  const out: SeriesPoint[] = [];
  const last = bucketKey(endDate, unit);
  for (let key = bucketKey(first, unit); key <= last; key = nextKey(key, unit)) {
    out.push({ ...(totals.get(key) ?? { day: key, orders: 0, sales: 0, revenue: 0 }), unit });
  }
  return out;
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}
