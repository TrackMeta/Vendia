"use client";

import { CircleHelp } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/** «?» junto a una métrica: explica qué es (al pasar el mouse en computadora, al tocar en el celular). */
export function Help({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <Popover>
      <PopoverTrigger openOnHover delay={150} aria-label={`¿Qué es ${label}?`} className="rounded-full text-muted-foreground/70 hover:text-foreground">
        <CircleHelp className="size-3.5" />
      </PopoverTrigger>
      <PopoverContent side="top" className="w-64 text-xs leading-relaxed">
        {children}
      </PopoverContent>
    </Popover>
  );
}

/**
 * Métrica principal (las 4 grandes del Inicio). `featured` = tarjeta grafito para la cifra que
 * más importa (la utilidad). Nunca en rojo: el rojo es para acciones.
 * `compact` = más chica en el celular (para filas de 3, como las tasas: «100%» tiene que entrar).
 */
export function KpiCard({
  label,
  value,
  sub,
  help,
  featured,
  compact,
}: {
  label: string;
  value: string;
  sub?: React.ReactNode;
  help?: React.ReactNode;
  featured?: boolean;
  compact?: boolean;
}) {
  return (
    <div className={cn("flex flex-col gap-1 rounded-xl ring-1", compact ? "p-3 sm:p-4" : "p-4", featured ? "dark bg-[#202124] text-white ring-transparent in-[.dark]:ring-white/10" : "bg-card ring-foreground/10")}>
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {label}
        {help ? <Help label={label}>{help}</Help> : null}
      </span>
      <span className={cn("leading-tight font-semibold tracking-tight tabular-nums", compact ? "text-[22px] sm:text-[28px]" : "text-[28px]")}>{value}</span>
      {sub ? <span className="text-xs text-muted-foreground">{sub}</span> : null}
    </div>
  );
}

/** Métrica secundaria: fila compacta etiqueta / valor dentro de una tarjeta de grupo. */
export function MiniStat({ label, value, hint, help, strong }: { label: string; value: string; hint?: string; help?: React.ReactNode; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
        {label}
        {help ? <Help label={label}>{help}</Help> : null}
      </span>
      <span className="flex items-baseline gap-2 text-right">
        {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
        <span className={cn("text-sm tabular-nums", strong && "font-semibold")}>{value}</span>
      </span>
    </div>
  );
}
