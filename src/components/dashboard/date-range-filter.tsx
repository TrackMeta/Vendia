import Link from "next/link";
import { cn } from "@/lib/utils";
import { type DateRange, RANGE_PRESETS } from "@/modules/metrics/date-range";

/** Filtro de fechas por URL (?rango=…&desde=…&hasta=…). Conserva otros parámetros. */
export function DateRangeFilter({
  basePath,
  range,
  params = {},
}: {
  basePath: string;
  range: DateRange;
  params?: Record<string, string | undefined>;
}) {
  const href = (preset: string) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) sp.set(k, v);
    sp.set("rango", preset);
    return `${basePath}?${sp.toString()}`;
  };

  return (
    <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
      {(Object.keys(RANGE_PRESETS) as (keyof typeof RANGE_PRESETS)[])
        .filter((p) => p !== "personalizado")
        .map((p) => (
          <Link
            key={p}
            href={href(p)}
            className={cn(
              "rounded-full border px-3 py-1 text-sm whitespace-nowrap",
              range.preset === p ? "border-foreground bg-foreground text-background" : "hover:bg-muted",
            )}
          >
            {RANGE_PRESETS[p]}
          </Link>
        ))}
      <form action={basePath} className="flex items-center gap-1.5">
        {Object.entries(params).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
        <input type="hidden" name="rango" value="personalizado" />
        <input type="date" name="desde" defaultValue={range.startDate} className="h-8 rounded-md border bg-transparent px-2 text-sm" aria-label="Desde" />
        <input type="date" name="hasta" defaultValue={range.endDate} className="h-8 rounded-md border bg-transparent px-2 text-sm" aria-label="Hasta" />
        <button type="submit" className="h-8 rounded-md border px-2 text-sm whitespace-nowrap hover:bg-muted">
          Aplicar
        </button>
      </form>
    </div>
  );
}

/** Lee el rango desde searchParams. */
export function rangeParams(sp: Record<string, string | string[] | undefined>) {
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  return { rango: s("rango"), desde: s("desde"), hasta: s("hasta") };
}
