"use client";

import { ArrowRight, CheckCircle2, Circle } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { SetupStep } from "./home-data";
import { dismissWelcome } from "./welcome-actions";

/**
 * «Prepara tu tienda»: los 5 pasos para vender. Se dibuja en el servidor (sin saltos al cargar),
 * desaparece sola al completar todo y «Ocultar» la guarda por tienda (se vuelve a ver desde Ayuda).
 */
export function HomeSetup({ steps }: { steps: SetupStep[] }) {
  const [hidden, setHidden] = useState(false);
  const [, startTransition] = useTransition();
  const done = steps.filter((s) => s.done).length;
  if (hidden || done === steps.length) return null;
  const next = steps.find((s) => !s.done);

  function hide() {
    // Se oculta al instante; el servidor guarda la preferencia de la tienda
    setHidden(true);
    startTransition(() => dismissWelcome());
  }

  return (
    <section aria-labelledby="prepara-titulo" className="flex flex-col gap-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <h2 id="prepara-titulo" className="text-sm">
            <span className="font-medium">Prepara tu tienda</span>
            <span className="text-muted-foreground">
              {" "}
              · {done} de {steps.length}
            </span>
          </h2>
          <div
            className="h-1.5 max-w-xs overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={steps.length}
            aria-valuenow={done}
            aria-label={`${done} de ${steps.length} pasos listos`}
          >
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.round((done / steps.length) * 100)}%` }} />
          </div>
        </div>
        <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={hide}>
          Ocultar
        </Button>
      </div>
      <ol className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
        {steps.map((s) => (
          // En el celular solo se ven los pasos que faltan
          <li key={s.key} className={s.done ? "hidden sm:block" : undefined}>
            <Link
              href={s.href}
              aria-current={s.key === next?.key ? "step" : undefined}
              className={cn(
                "flex h-full gap-2.5 rounded-lg border p-2.5 transition-colors hover:bg-muted/50",
                s.key === next?.key && "border-primary/50 bg-primary/5",
              )}
            >
              {s.done ? (
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-label="Listo" />
              ) : (
                <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-label="Pendiente" />
              )}
              <span className="flex min-w-0 flex-col">
                <span className={cn("text-sm font-medium", s.done && "text-muted-foreground line-through")}>{s.title}</span>
                <span className="text-xs text-muted-foreground">{s.text}</span>
              </span>
              {s.key === next?.key ? <ArrowRight className="mt-0.5 ml-auto size-3.5 shrink-0 text-primary" /> : null}
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
