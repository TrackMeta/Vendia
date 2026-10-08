"use client";

import { ArrowDown, ArrowUp, Columns3, ImageOff } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatMoney, formatNumber, formatPercent, formatRatio } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { PerformanceRow } from "@/modules/metrics";

export type PerfRow = PerformanceRow & { key: string; name: string; subtitle: string | null; status: string | null; thumbnail: string | null };

type Kind = "money" | "number" | "percent" | "ratio";
type Column = { id: string; label: string; group: "Meta" | "Vendia"; kind: Kind; get: (r: PerfRow) => number | null; hint?: string; highlight?: boolean };

/** Columnas disponibles. El CPA real va junto al costo por resultado de Meta. */
const COLUMNS: Column[] = [
  { id: "spend", label: "Gasto", group: "Meta", kind: "money", get: (r) => r.ad_spend ?? 0 },
  { id: "impressions", label: "Impresiones", group: "Meta", kind: "number", get: (r) => r.impressions },
  { id: "reach", label: "Alcance", group: "Meta", kind: "number", get: (r) => r.reach },
  { id: "cpm", label: "CPM", group: "Meta", kind: "money", get: (r) => r.cpm },
  { id: "clicks", label: "Clics", group: "Meta", kind: "number", get: (r) => r.clicks },
  { id: "ctr", label: "CTR", group: "Meta", kind: "percent", get: (r) => r.ctr },
  { id: "cpc", label: "CPC", group: "Meta", kind: "money", get: (r) => r.cpc },
  { id: "results", label: "Resultados (Meta)", group: "Meta", kind: "number", get: (r) => r.results, hint: "Leads que cuenta Meta" },
  { id: "cpr", label: "Costo por resultado (Meta)", group: "Meta", kind: "money", get: (r) => r.costPerResult },
  { id: "visits", label: "Visitas", group: "Vendia", kind: "number", get: (r) => r.visits ?? 0 },
  { id: "orders", label: "Pedidos", group: "Vendia", kind: "number", get: (r) => r.orders },
  { id: "cpo", label: "Costo por pedido", group: "Vendia", kind: "money", get: (r) => r.cpa.perOrder },
  { id: "confirmed", label: "Confirmados", group: "Vendia", kind: "number", get: (r) => r.confirmed },
  { id: "confirmationRate", label: "% confirmación", group: "Vendia", kind: "percent", get: (r) => r.confirmationRate },
  { id: "sales", label: "Ventas reales", group: "Vendia", kind: "number", get: (r) => r.delivered, highlight: true },
  { id: "cpa", label: "CPA real", group: "Vendia", kind: "money", get: (r) => r.cpa.perDelivered, highlight: true, hint: "Gasto ÷ ventas reales" },
  { id: "effectiveRate", label: "% venta", group: "Vendia", kind: "percent", get: (r) => r.effectiveRate, hint: "Ventas reales ÷ pedidos" },
  { id: "revenue", label: "Revenue real", group: "Vendia", kind: "money", get: (r) => r.revenue },
  { id: "roas", label: "ROAS real", group: "Vendia", kind: "ratio", get: (r) => r.roas.real, highlight: true },
  { id: "profit", label: "Utilidad", group: "Vendia", kind: "money", get: (r) => r.profit, highlight: true },
];

const DEFAULT_COLUMNS = ["spend", "results", "cpr", "orders", "cpo", "confirmationRate", "sales", "cpa", "roas", "profit"];
const STORAGE_KEY = "vendia:rendimiento:columnas";

function format(kind: Kind, v: number | null) {
  if (v === null || v === undefined) return "—";
  if (kind === "money") return formatMoney(v);
  if (kind === "percent") return formatPercent(v);
  if (kind === "ratio") return formatRatio(v);
  return formatNumber(v);
}

// Columnas elegidas: preferencia de este navegador (si el almacenamiento falla, se usan las de siempre)
const listeners = new Set<() => void>();
function readColumns(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}
function writeColumns(ids: string[]) {
  try {
    localStorage.setItem(STORAGE_KEY, ids.join(","));
  } catch {
    // sin almacenamiento: la elección dura hasta recargar
  }
  for (const l of listeners) l();
}
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function PerformanceTable({ rows, firstColumn, showMeta }: { rows: PerfRow[]; firstColumn: string; showMeta: boolean }) {
  const stored = useSyncExternalStore(subscribe, readColumns, () => "");
  const [memory, setMemory] = useState<string[] | null>(null);
  const chosen = memory ?? (stored ? stored.split(",").filter((id) => COLUMNS.some((c) => c.id === id)) : DEFAULT_COLUMNS);
  const columns = COLUMNS.filter((c) => chosen.includes(c.id) && (showMeta || c.group === "Vendia" || c.id === "spend"));
  const [sort, setSort] = useState<{ id: string; desc: boolean }>({ id: "spend", desc: true });

  const toggle = (id: string) => {
    const next = chosen.includes(id) ? chosen.filter((x) => x !== id) : COLUMNS.map((c) => c.id).filter((x) => x === id || chosen.includes(x));
    setMemory(next);
    writeColumns(next);
  };

  const sortCol = COLUMNS.find((c) => c.id === sort.id);
  const sorted = [...rows].sort((a, b) => {
    const va = sortCol?.get(a) ?? -Infinity;
    const vb = sortCol?.get(b) ?? -Infinity;
    return sort.desc ? vb - va : va - vb;
  });
  const total = (col: Column) => {
    if (col.kind !== "number" && col.id !== "spend" && col.id !== "revenue" && col.id !== "profit") return null;
    return rows.reduce((s, r) => s + (col.get(r) ?? 0), 0);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-end">
        <Popover>
          <PopoverTrigger render={<Button variant="outline" size="sm" />}>
            <Columns3 /> Columnas
          </PopoverTrigger>
          <PopoverContent align="end" className="w-72">
            {(["Meta", "Vendia"] as const).map((group) => (
              <div key={group} className="flex flex-col gap-1">
                <p className="text-xs font-medium text-muted-foreground">{group === "Meta" ? "Meta Ads" : "Vendia (ventas reales)"}</p>
                {COLUMNS.filter((c) => c.group === group).map((c) => (
                  <label key={c.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={chosen.includes(c.id)} onChange={() => toggle(c.id)} className="size-4" />
                    {c.label}
                  </label>
                ))}
              </div>
            ))}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setMemory(DEFAULT_COLUMNS);
                writeColumns(DEFAULT_COLUMNS);
              }}
            >
              Restablecer
            </Button>
          </PopoverContent>
        </Popover>
      </div>

      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th className="sticky left-0 z-10 bg-muted/90 px-3 py-2 text-left font-medium backdrop-blur">{firstColumn}</th>
              {columns.map((c) => (
                <th key={c.id} className={cn("px-3 py-2 text-right font-medium whitespace-nowrap", c.highlight && "text-foreground")} title={c.hint}>
                  <button
                    type="button"
                    onClick={() => setSort((s) => ({ id: c.id, desc: s.id === c.id ? !s.desc : true }))}
                    className="inline-flex items-center gap-1"
                  >
                    {c.label}
                    {sort.id === c.id ? sort.desc ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" /> : null}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.key} className="border-t">
                <td className="sticky left-0 z-10 max-w-72 bg-background px-3 py-2">
                  <div className="flex items-center gap-2">
                    {firstColumn === "Anuncio" ? (
                      r.thumbnail ? (
                        // Miniatura servida por Meta (dominio externo variable)
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={r.thumbnail} alt="" className="size-9 shrink-0 rounded object-cover" />
                      ) : (
                        <span className="flex size-9 shrink-0 items-center justify-center rounded bg-muted">
                          <ImageOff className="size-4 text-muted-foreground" />
                        </span>
                      )
                    ) : null}
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate font-medium" title={r.name}>
                        {r.name}
                      </span>
                      {r.subtitle || r.status ? (
                        <span className="truncate text-xs text-muted-foreground">
                          {[r.status ? r.status.toLowerCase().replace(/_/g, " ") : null, r.subtitle].filter(Boolean).join(" · ")}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </td>
                {columns.map((c) => (
                  <td key={c.id} className={cn("px-3 py-2 text-right whitespace-nowrap tabular-nums", c.highlight && "font-medium")}>
                    {format(c.kind, c.get(r))}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t bg-muted/30 text-xs font-medium">
            <tr>
              <td className="sticky left-0 bg-muted/90 px-3 py-2">Total ({rows.length})</td>
              {columns.map((c) => {
                const t = total(c);
                return (
                  <td key={c.id} className="px-3 py-2 text-right tabular-nums">
                    {t === null ? "" : format(c.kind, t)}
                  </td>
                );
              })}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
