"use client";

import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { addDays, type DateRange, formatRangeLabel, limaToday, RANGE_PRESETS, type RangePreset, resolveRange } from "@/modules/metrics/date-range";

const WEEKDAYS = ["L", "M", "M", "J", "V", "S", "D"];
const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const PRESETS = (Object.keys(RANGE_PRESETS) as RangePreset[]).filter((p) => p !== "personalizado");

/** Primer día (YYYY-MM-01) del mes `offset` meses después de `month`. */
function shiftMonth(month: string, offset: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + offset, 1));
  return d.toISOString().slice(0, 10);
}

function MonthGrid({
  month,
  start,
  end,
  hover,
  today,
  onPick,
  onHover,
}: {
  month: string;
  start: string | null;
  end: string | null;
  hover: string | null;
  today: string;
  onPick: (day: string) => void;
  onHover: (day: string | null) => void;
}) {
  const [y, m] = month.split("-").map(Number);
  const firstWeekday = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7; // lunes = 0
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const rangeEnd = end ?? (start && hover && hover >= start ? hover : null);
  const cells: (string | null)[] = [...Array(firstWeekday).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => addDays(month, i))];

  return (
    <div className="flex w-full flex-col gap-1 sm:w-60">
      <p className="text-center text-sm font-medium capitalize">
        {MONTHS[m - 1]} {y}
      </p>
      <div className="grid grid-cols-7 text-center text-xs text-muted-foreground">
        {WEEKDAYS.map((d, i) => (
          <span key={i} className="py-1">
            {d}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-y-0.5 text-center text-sm" onMouseLeave={() => onHover(null)}>
        {cells.map((day, i) => {
          if (!day) return <span key={`e${i}`} />;
          const future = day > today;
          const isEdge = day === start || day === rangeEnd;
          const inRange = start && rangeEnd && day > start && day < rangeEnd;
          return (
            <button
              key={day}
              type="button"
              disabled={future}
              onClick={() => onPick(day)}
              onMouseEnter={() => onHover(day)}
              className={cn(
                "h-8 rounded-md tabular-nums transition-colors",
                future ? "cursor-not-allowed text-muted-foreground/40" : "hover:bg-muted",
                inRange && "rounded-none bg-primary/10",
                isEdge && "bg-primary font-semibold text-primary-foreground hover:bg-primary",
                day === today && !isEdge && "font-semibold underline underline-offset-4",
              )}
            >
              {Number(day.slice(8))}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Selector de fechas estándar de Vendia (estilo Administrador de anuncios de Meta, ver docs/UI.md):
 * presets a la izquierda, dos meses a la derecha, semana desde el lunes, hora de Lima.
 */
export function DateRangePicker({ basePath, range, params = {} }: { basePath: string; range: DateRange; params?: Record<string, string | undefined> }) {
  const router = useRouter();
  const today = limaToday();
  const [open, setOpen] = useState(false);
  const [preset, setPreset] = useState<RangePreset>(range.preset);
  const [start, setStart] = useState<string | null>(range.startDate);
  const [end, setEnd] = useState<string | null>(range.endDate);
  const [hover, setHover] = useState<string | null>(null);
  // Mes de la izquierda: el anterior al mes final, para ver el rango completo
  const [month, setMonth] = useState(() => shiftMonth(`${range.endDate.slice(0, 7)}-01`, -1));

  const reset = () => {
    setPreset(range.preset);
    setStart(range.startDate);
    setEnd(range.endDate);
    setMonth(shiftMonth(`${range.endDate.slice(0, 7)}-01`, -1));
  };

  const choosePreset = (p: RangePreset) => {
    const r = resolveRange(p);
    setPreset(p);
    setStart(r.startDate);
    setEnd(r.endDate);
    setMonth(shiftMonth(`${r.endDate.slice(0, 7)}-01`, -1));
  };

  const pickDay = (day: string) => {
    setPreset("personalizado");
    if (!start || end) {
      setStart(day);
      setEnd(null);
    } else if (day < start) {
      setEnd(start);
      setStart(day);
    } else setEnd(day);
  };

  const apply = () => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) sp.set(k, v);
    sp.set("rango", preset);
    if (preset === "personalizado" && start) {
      sp.set("desde", start);
      sp.set("hasta", end ?? start);
    }
    setOpen(false);
    router.push(`${basePath}?${sp.toString()}`);
  };

  const triggerLabel = range.preset === "personalizado" ? range.label : `${RANGE_PRESETS[range.preset]}: ${formatRangeLabel(range.startDate, range.endDate)}`;

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) reset();
      }}
    >
      <PopoverTrigger render={<Button variant="outline" className="w-fit max-w-full justify-start" />}>
        <CalendarDays /> <span className="truncate">{triggerLabel}</span>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(calc(100vw-2rem),46rem)] p-0">
        <div className="flex flex-col sm:flex-row">
          <ul className="flex gap-1 overflow-x-auto border-b p-2 sm:w-44 sm:flex-col sm:overflow-visible sm:border-r sm:border-b-0">
            {PRESETS.map((p) => (
              <li key={p}>
                <button
                  type="button"
                  onClick={() => choosePreset(p)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm whitespace-nowrap hover:bg-muted",
                    preset === p && "bg-primary/10 font-medium text-primary",
                  )}
                >
                  <span className={cn("hidden size-3.5 rounded-full border sm:inline-block", preset === p && "border-4 border-primary")} />
                  {RANGE_PRESETS[p]}
                </button>
              </li>
            ))}
          </ul>
          <div className="flex flex-1 flex-col gap-2 p-3">
            <div className="flex items-start gap-2">
              <Button size="icon-sm" variant="ghost" onClick={() => setMonth((m) => shiftMonth(m, -1))} aria-label="Mes anterior">
                <ChevronLeft />
              </Button>
              <div className="flex flex-1 justify-center gap-6">
                <div className="hidden sm:block">
                  <MonthGrid month={month} start={start} end={end} hover={hover} today={today} onPick={pickDay} onHover={setHover} />
                </div>
                <MonthGrid month={shiftMonth(month, 1)} start={start} end={end} hover={hover} today={today} onPick={pickDay} onHover={setHover} />
              </div>
              <Button
                size="icon-sm"
                variant="ghost"
                onClick={() => setMonth((m) => shiftMonth(m, 1))}
                disabled={shiftMonth(month, 1) >= `${today.slice(0, 7)}-01`}
                aria-label="Mes siguiente"
              >
                <ChevronRight />
              </Button>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t p-3">
          <div className="flex min-w-0 flex-col">
            <span className="text-sm font-medium">{start ? formatRangeLabel(start, end ?? start) : "Elige las fechas"}</span>
            <span className="text-xs text-muted-foreground">Las fechas se muestran en la hora de Lima</span>
          </div>
          <div className="ml-auto flex gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={apply} disabled={!start}>
              Actualizar
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
