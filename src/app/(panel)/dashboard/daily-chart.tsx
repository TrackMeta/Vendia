"use client";

import { useState } from "react";
import { formatMoney, formatNumber, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import { formatShortDate } from "@/modules/metrics/date-range";
import type { SeriesPoint } from "@/modules/metrics/daily";

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "set", "oct", "nov", "dic"];

/** Paleta validada (daltonismo y contraste): azul = pedidos, rojo de marca = ventas reales. */
const ORDERS = "bg-[#4c8df6]";
const SALES = "bg-[#e53935] dark:bg-[#ef5350]";

function shortLabel(p: SeriesPoint): string {
  const [, m, d] = p.day.split("-").map(Number);
  return p.unit === "month" ? `${MONTHS[m - 1]}` : `${d} ${MONTHS[m - 1]}`;
}

function fullLabel(p: SeriesPoint): string {
  if (p.unit === "week") return `Semana del ${formatShortDate(p.day)}`;
  if (p.unit === "month") {
    const [y, m] = p.day.split("-").map(Number);
    return `${MONTHS[m - 1]} ${y}`;
  }
  return formatShortDate(p.day);
}

/** Tope «redondo» del eje: 7 → 8, 23 → 25, 140 → 150. */
function niceMax(n: number): number {
  if (n <= 4) return 4;
  const pow = 10 ** Math.floor(Math.log10(n));
  const step = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((s) => s * pow >= n) ?? 10;
  return step * pow;
}

/**
 * Pedidos y ventas reales por día (o semana/mes en rangos largos). Columnas finas desde una sola
 * línea base, un solo eje, leyenda siempre visible y detalle al pasar el mouse o tocar.
 */
export function DailyChart({ points }: { points: SeriesPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = niceMax(Math.max(1, ...points.map((p) => p.orders)));
  const ticks = [max, max / 2, 0];
  const every = Math.max(1, Math.ceil(points.length / 7));
  const unitWord = points[0]?.unit === "week" ? "semana" : points[0]?.unit === "month" ? "mes" : "día";
  const active = hover === null ? null : points[hover];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium">Pedidos y ventas reales por {unitWord}</h2>
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className={cn("size-2.5 rounded-sm", ORDERS)} /> Pedidos
          </span>
          <span className="flex items-center gap-1.5">
            <span className={cn("size-2.5 rounded-sm", SALES)} /> Ventas reales
          </span>
        </div>
      </div>

      <div className="relative flex gap-2">
        {/* Eje Y: solo 3 marcas redondas */}
        <div className="flex h-44 w-7 shrink-0 flex-col justify-between text-right text-[11px] text-muted-foreground tabular-nums" aria-hidden>
          {ticks.map((t) => (
            <span key={t} className="-translate-y-1/2 leading-none first:translate-y-0 last:translate-y-0">
              {formatNumber(t)}
            </span>
          ))}
        </div>
        <div className="relative min-w-0 flex-1">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-44" aria-hidden>
            <div className="absolute inset-x-0 top-0 border-t border-border/70" />
            <div className="absolute inset-x-0 top-1/2 border-t border-border/70" />
            <div className="absolute inset-x-0 bottom-0 border-t border-border" />
          </div>
          <div className="relative flex h-44 items-end" onMouseLeave={() => setHover(null)}>
            {points.map((p, i) => (
              <button
                key={p.day}
                type="button"
                onMouseEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                onClick={() => setHover(hover === i ? null : i)}
                aria-label={`${fullLabel(p)}: ${p.orders} pedidos, ${p.sales} ventas reales`}
                className={cn("flex h-full min-w-0 flex-1 items-end justify-center gap-[2px] rounded-sm px-[1px] outline-none", hover === i && "bg-muted/70")}
              >
                <span className={cn("w-full max-w-3 rounded-t-[3px]", ORDERS)} style={{ height: `${(p.orders / max) * 100}%` }} />
                <span className={cn("w-full max-w-3 rounded-t-[3px]", SALES)} style={{ height: `${(p.sales / max) * 100}%` }} />
              </button>
            ))}
          </div>
          <div className="mt-1.5 flex text-[11px] text-muted-foreground" aria-hidden>
            {points.map((p, i) => (
              <span key={p.day} className="min-w-0 flex-1 text-center whitespace-nowrap">
                {i % every === 0 ? shortLabel(p) : ""}
              </span>
            ))}
          </div>

          {active ? (
            <div
              className="pointer-events-none absolute top-0 z-10 w-44 rounded-lg border bg-popover p-2.5 text-xs text-popover-foreground shadow-md"
              style={{
                left: `${((hover! + 0.5) / points.length) * 100}%`,
                transform: `translateX(${hover! / points.length > 0.6 ? "-105%" : "8px"})`,
              }}
            >
              <p className="mb-1.5 font-medium">{fullLabel(active)}</p>
              <p className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <span className={cn("size-2 rounded-sm", ORDERS)} /> Pedidos
                </span>
                <span className="font-medium tabular-nums">{formatNumber(active.orders)}</span>
              </p>
              <p className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <span className={cn("size-2 rounded-sm", SALES)} /> Ventas reales
                </span>
                <span className="font-medium tabular-nums">{formatNumber(active.sales)}</span>
              </p>
              <p className="mt-1 flex justify-between gap-2 border-t pt-1 text-muted-foreground">
                Ingreso <span className="font-medium text-foreground tabular-nums">{formatMoney(active.revenue)}</span>
              </p>
              {active.orders ? (
                <p className="flex justify-between gap-2 text-muted-foreground">
                  Efectividad <span className="font-medium text-foreground tabular-nums">{formatPercent(active.sales / active.orders)}</span>
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      {/* Vista de tabla para lectores de pantalla */}
      <table className="sr-only">
        <caption>Pedidos y ventas reales por {unitWord}</caption>
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Pedidos</th>
            <th>Ventas reales</th>
            <th>Ingreso</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.day}>
              <td>{fullLabel(p)}</td>
              <td>{p.orders}</td>
              <td>{p.sales}</td>
              <td>{formatMoney(p.revenue)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
