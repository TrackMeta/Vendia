import type { DateRange } from "@/modules/metrics/date-range";
import { DateRangePicker } from "./date-range-picker";

/** Filtro de fechas por URL (?rango=…&desde=…&hasta=…), estilo Meta. Conserva otros parámetros. */
export function DateRangeFilter({ basePath, range, params = {} }: { basePath: string; range: DateRange; params?: Record<string, string | undefined> }) {
  return <DateRangePicker key={`${range.preset}-${range.startDate}-${range.endDate}`} basePath={basePath} range={range} params={params} />;
}

/** Lee el rango desde searchParams. */
export function rangeParams(sp: Record<string, string | string[] | undefined>) {
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  return { rango: s("rango"), desde: s("desde"), hasta: s("hasta") };
}
