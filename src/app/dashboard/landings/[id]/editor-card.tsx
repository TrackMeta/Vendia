import { cn } from "@/lib/utils";

/** Tarjeta blanca del panel del editor: cada sección se ve como un bloque separado sobre el fondo gris. */
export function EditorCard({ title, hint, action, children, className }: { title?: string; hint?: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-sm", className)}>
      {title || action ? (
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            {title ? <h3 className="text-sm font-semibold">{title}</h3> : null}
            {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
          </div>
          {action}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/** Título pequeño de un grupo dentro del panel (ej: «Bloques de la página»). */
export function EditorGroupTitle({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{children}</p>
      {action}
    </div>
  );
}
