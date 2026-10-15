import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

/** Fila que se desliza de lado en el celular, sin barra de desplazamiento visible. */
export const SCROLL_ROW = "-mx-1 flex gap-1.5 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden";

/** Chip de estado o bandeja con su contador. */
export function CountChip({ href, active, label, count }: { href: string; active: boolean; label: string; count: number }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm whitespace-nowrap transition-colors md:h-8",
        active ? "border-foreground bg-foreground font-medium text-background" : "bg-background hover:bg-muted",
        !active && count === 0 && "text-muted-foreground",
      )}
    >
      {label}
      <span className={cn("text-xs tabular-nums", active ? "opacity-70" : "text-muted-foreground")}>{count}</span>
    </Link>
  );
}

/** Control segmentado con links (los filtros viven en la URL). */
export function Segmented({ label, options }: { label: string; options: { key: string; label: string; href: string; active: boolean }[] }) {
  return (
    <div role="group" aria-label={label} className="inline-flex h-9 shrink-0 items-center rounded-lg bg-muted p-0.5 md:h-8">
      {options.map((o) => (
        <Link
          key={o.key}
          href={o.href}
          aria-current={o.active ? "true" : undefined}
          className={cn(
            "inline-flex h-8 items-center rounded-md px-2.5 text-sm whitespace-nowrap transition-colors md:h-7",
            o.active ? "bg-background font-medium text-foreground shadow-sm ring-1 ring-foreground/10" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </Link>
      ))}
    </div>
  );
}

/** Chip que se prende y apaga (Solo míos, Ordenar por zona). */
export function ToggleChip({ href, active, icon: Icon, title, children }: { href: string; active: boolean; icon: LucideIcon; title?: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      title={title}
      aria-current={active ? "true" : undefined}
      className={cn(
        "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-sm whitespace-nowrap transition-colors md:h-8",
        active ? "border-primary bg-primary/10 font-medium text-primary" : "bg-background text-foreground hover:bg-muted",
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      {children}
    </Link>
  );
}
