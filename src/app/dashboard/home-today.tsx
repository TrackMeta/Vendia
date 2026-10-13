import { ChevronRight, CircleCheck, Clock, type LucideIcon, MousePointerClick, PackageCheck, PhoneCall, Wallet } from "lucide-react";
import Link from "next/link";
import { formatMoney, formatNumber } from "@/lib/format";
import type { TodayItem, TodayKey } from "./home-data";

const ICONS: Record<TodayKey, LucideIcon> = {
  confirmar: PhoneCall,
  despachar: PackageCheck,
  liquidar: Wallet,
  agencia: Clock,
  abandonados: MousePointerClick,
};

/** Texto de cada pendiente: la cifra en negrita y el resto corto. */
function ItemText({ item }: { item: TodayItem }) {
  const n = <strong className="font-semibold tabular-nums">{formatNumber(item.count)}</strong>;
  const one = item.count === 1;
  switch (item.key) {
    case "confirmar":
      return <>{n} {one ? "pedido por confirmar" : "pedidos por confirmar"}</>;
    case "despachar":
      return <>{n} por despachar</>;
    case "liquidar":
      return (
        <>
          Couriers de Lima te deben <strong className="font-semibold tabular-nums">{formatMoney(item.amount ?? 0)}</strong>
        </>
      );
    case "agencia":
      return <>{n} en agencia hace más de 3 días</>;
    case "abandonados":
      return <>{n} {one ? "formulario abandonado hoy" : "formularios abandonados hoy"}</>;
  }
}

/** «Lo que toca hoy»: lo pendiente ahora mismo (no depende de las fechas elegidas). */
export function HomeToday({ items }: { items: TodayItem[] }) {
  if (!items.length) {
    return (
      <p className="flex items-center gap-2 rounded-xl bg-card px-4 py-3 text-sm text-muted-foreground ring-1 ring-foreground/10">
        <CircleCheck className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
        Todo al día: nada pendiente por ahora.
      </p>
    );
  }
  return (
    <section aria-labelledby="hoy-titulo" className="flex flex-col gap-2">
      <h2 id="hoy-titulo" className="text-sm font-medium">
        Lo que toca hoy
      </h2>
      <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((item) => {
          const Icon = ICONS[item.key];
          return (
            <li key={item.key}>
              <Link
                href={item.href}
                className="group flex min-h-12 items-center gap-3 rounded-xl bg-card px-3 py-2.5 text-sm ring-1 ring-foreground/10 transition-colors hover:bg-muted/60"
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="size-4" />
                </span>
                <span className="min-w-0 flex-1 leading-snug">
                  <ItemText item={item} />
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
