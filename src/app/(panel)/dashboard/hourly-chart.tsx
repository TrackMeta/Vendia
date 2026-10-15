"use client";

import { useState } from "react";
import { formatNumber, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Mismo azul de «Pedidos» que el gráfico por día (paleta validada). */
const ORDERS = "bg-[#4c8df6]";

/** «2 p. m.», «12 a. m.» */
function hour12(h: number): string {
  const n = h % 12 === 0 ? 12 : h % 12;
  return `${n} ${h < 12 ? "a. m." : "p. m."}`;
}

/** Tope «redondo» del eje: 7 → 8, 23 → 25, 140 → 150. */
function niceMax(n: number): number {
  if (n <= 4) return 4;
  const pow = 10 ** Math.floor(Math.log10(n));
  const step = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((s) => s * pow >= n) ?? 10;
  return step * pow;
}

/**
 * Pedidos por hora del día (hora de Perú) en el rango elegido: a qué horas compran más.
 * Columnas finas desde una sola línea base, un solo eje y detalle al pasar el mouse o tocar.
 */
export function HourlyChart({ hours }: { hours: number[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const total = hours.reduce((s, n) => s + n, 0);
  const max = niceMax(Math.max(1, ...hours));
  const ticks = [max, max / 2, 0];
  const peak = hours.indexOf(Math.max(...hours));
  const active = hover === null ? null : hover;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="text-sm font-medium">Pedidos por hora</h2>
        {total ? (
          <p className="text-xs text-muted-foreground">
            Más pedidos: <span className="font-medium text-foreground">{hour12(peak)} a {hour12((peak + 1) % 24)}</span>
          </p>
        ) : null}
      </div>

      <div className="relative flex gap-2">
        <div className="flex h-36 w-7 shrink-0 flex-col justify-between text-right text-[11px] text-muted-foreground tabular-nums" aria-hidden>
          {ticks.map((t) => (
            <span key={t} className="-translate-y-1/2 leading-none first:translate-y-0 last:translate-y-0">
              {formatNumber(t)}
            </span>
          ))}
        </div>
        <div className="relative min-w-0 flex-1">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-36" aria-hidden>
            <div className="absolute inset-x-0 top-0 border-t border-border/70" />
            <div className="absolute inset-x-0 top-1/2 border-t border-border/70" />
            <div className="absolute inset-x-0 bottom-0 border-t border-border" />
          </div>
          <div className="relative flex h-36 items-end" onMouseLeave={() => setHover(null)}>
            {hours.map((n, h) => (
              <button
                key={h}
                type="button"
                onMouseEnter={() => setHover(h)}
                onFocus={() => setHover(h)}
                onClick={() => setHover(hover === h ? null : h)}
                aria-label={`De ${hour12(h)} a ${hour12((h + 1) % 24)}: ${n} pedidos`}
                className={cn("flex h-full min-w-0 flex-1 items-end justify-center rounded-sm px-[1px] outline-none", hover === h && "bg-muted/70")}
              >
                <span className={cn("w-full max-w-4 rounded-t-[3px]", ORDERS)} style={{ height: `${(n / max) * 100}%` }} />
              </button>
            ))}
          </div>
          {/* Cada 3 horas, en formato de 24 h para que entre en el celular */}
          <div className="mt-1.5 flex text-[11px] text-muted-foreground tabular-nums" aria-hidden>
            {hours.map((_, h) => (
              <span key={h} className="min-w-0 flex-1 text-center whitespace-nowrap">
                {h % 3 === 0 ? `${h}h` : ""}
              </span>
            ))}
          </div>

          {active !== null ? (
            <div
              className="pointer-events-none absolute top-0 z-10 w-40 rounded-lg border bg-popover p-2.5 text-xs text-popover-foreground shadow-md"
              style={{
                left: `${((active + 0.5) / 24) * 100}%`,
                transform: `translateX(${active / 24 > 0.6 ? "-105%" : "8px"})`,
              }}
            >
              <p className="mb-1.5 font-medium">
                {hour12(active)} a {hour12((active + 1) % 24)}
              </p>
              <p className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <span className={cn("size-2 rounded-sm", ORDERS)} /> Pedidos
                </span>
                <span className="font-medium tabular-nums">{formatNumber(hours[active])}</span>
              </p>
              {total ? (
                <p className="flex justify-between gap-2 text-muted-foreground">
                  Del total <span className="font-medium text-foreground tabular-nums">{formatPercent(hours[active] / total)}</span>
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      {/* Vista de tabla para lectores de pantalla */}
      <table className="sr-only">
        <caption>Pedidos por hora del día</caption>
        <thead>
          <tr>
            <th>Hora</th>
            <th>Pedidos</th>
          </tr>
        </thead>
        <tbody>
          {hours.map((n, h) => (
            <tr key={h}>
              <td>
                {hour12(h)} a {hour12((h + 1) % 24)}
              </td>
              <td>{n}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
