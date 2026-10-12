import { cn } from "@/lib/utils";

/** Logo de Vendia: la «V» roja sin fondo (public/brand). Se ve igual sobre el menú grafito y sobre fondo claro. */
export function BrandMark({ className }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- logo fijo de 10 KB: no necesita el optimizador de imágenes
    <img src="/brand/vendia-v.png" alt="" aria-hidden width={33} height={28} className={cn("h-7 w-auto shrink-0 object-contain", className)} />
  );
}

/** Logo + nombre. `tone="light"` para fondos oscuros (menú grafito). */
export function BrandLogo({ className, tone = "dark" }: { className?: string; tone?: "dark" | "light" }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <BrandMark className="h-6" />
      <span className={cn("text-[17px] font-semibold tracking-tight", tone === "light" ? "text-white" : "text-foreground")}>Vendia</span>
    </span>
  );
}
