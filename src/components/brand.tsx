import { cn } from "@/lib/utils";

/** Marca de Vendia (provisional): «V» blanca sobre cuadrado rojo. Misma forma que el favicon y el ícono de la app. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-flex size-7 shrink-0 items-center justify-center rounded-lg bg-[#e53935] text-[15px] leading-none font-bold text-white", className)}
    >
      V
    </span>
  );
}

/** Marca + nombre. `tone="light"` para fondos oscuros (menú grafito). */
export function BrandLogo({ className, tone = "dark" }: { className?: string; tone?: "dark" | "light" }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <BrandMark />
      <span className={cn("text-[17px] font-semibold tracking-tight", tone === "light" ? "text-white" : "text-foreground")}>Vendia</span>
    </span>
  );
}
