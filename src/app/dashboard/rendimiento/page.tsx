import { BarChart3 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { DateRangeFilter, rangeParams } from "@/components/dashboard/date-range-filter";
import { EmptyState, PageHeader } from "@/components/dashboard/page-header";
import { requireOwner } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { computePerformanceRow } from "@/modules/metrics";
import { resolveRange } from "@/modules/metrics/date-range";
import { type PerfRow, PerformanceTable } from "./performance-table";

export const metadata: Metadata = { title: "Rendimiento" };

const LEVELS = {
  campanas: { label: "Campañas", first: "Campaña", rpc: "campaign" },
  conjuntos: { label: "Conjuntos", first: "Conjunto", rpc: "adset" },
  anuncios: { label: "Anuncios", first: "Anuncio", rpc: "ad" },
  angulos: { label: "Ángulos", first: "Ángulo", rpc: null },
  productos: { label: "Productos", first: "Producto", rpc: null },
  paginas: { label: "Páginas", first: "Página", rpc: "page" },
} as const;
type Level = keyof typeof LEVELS;

export default async function PerformancePage({ searchParams }: PageProps<"/dashboard/rendimiento">) {
  const sp = await searchParams;
  const level: Level = typeof sp.nivel === "string" && sp.nivel in LEVELS ? (sp.nivel as Level) : "campanas";
  const rp = rangeParams(sp);
  const range = resolveRange(rp.rango, rp.desde, rp.hasta);
  const { store } = await requireOwner();
  const supabase = await createClient();
  const cfg = LEVELS[level];

  const [{ data }, { data: meta }] = await Promise.all([
    cfg.rpc
      ? supabase.rpc("get_performance", {
          p_store_id: store.id,
          p_from: range.from,
          p_to: range.to,
          p_from_date: range.startDate,
          p_to_date: range.endDate,
          p_level: cfg.rpc,
        })
      : level === "productos"
        ? supabase.rpc("get_product_stats", { p_store_id: store.id, p_from: range.from, p_to: range.to, p_from_date: range.startDate, p_to_date: range.endDate })
        : Promise.resolve({ data: [] }),
    supabase.from("store_meta_settings").select("ad_account_id, ad_account_name, last_sync_at").eq("store_id", store.id).maybeSingle(),
  ]);

  const raw = (data ?? []) as Record<string, unknown>[];
  const rows: PerfRow[] = raw.map((r) => ({
    ...computePerformanceRow(r),
    key: String(r.key ?? r.product_id),
    name: String(r.name ?? r.key ?? "—"),
    subtitle: [r.adset_name, r.campaign_name].filter(Boolean).join(" · ") || null,
    status: (r.status as string | null) ?? null,
    thumbnail: (r.thumbnail_url as string | null) ?? null,
  }));
  const showMeta = cfg.rpc === "campaign" || cfg.rpc === "adset" || cfg.rpc === "ad";

  const href = (nivel: Level) => {
    const q = new URLSearchParams();
    q.set("nivel", nivel);
    if (rp.rango) q.set("rango", rp.rango);
    if (rp.desde) q.set("desde", rp.desde);
    if (rp.hasta) q.set("hasta", rp.hasta);
    return `/dashboard/rendimiento?${q.toString()}`;
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Rendimiento"
        description="Lo que dice Meta junto a lo que de verdad vendiste: el costo por resultado de Meta al lado de tu CPA real."
      />
      <div className="flex flex-wrap items-center gap-3">
        <DateRangeFilter basePath="/dashboard/rendimiento" range={range} params={{ nivel: level }} />
        <span className="text-xs text-muted-foreground">
          {meta?.ad_account_id ? (
            <>
              {meta.ad_account_name} · sincronizado {meta.last_sync_at ? formatDateTime(meta.last_sync_at) : "—"}
            </>
          ) : (
            <>
              Sin cuenta de Meta conectada: el gasto viene de Gastos.{" "}
              <Link href="/dashboard/marketing" className="underline">
                Conectar Meta
              </Link>
            </>
          )}
        </span>
      </div>
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {(Object.keys(LEVELS) as Level[]).map((l) => (
          <Link
            key={l}
            href={href(l)}
            className={cn("rounded-full border px-3 py-1 text-sm whitespace-nowrap", level === l ? "border-foreground bg-foreground text-background" : "hover:bg-muted")}
          >
            {LEVELS[l].label}
          </Link>
        ))}
      </div>

      {level === "angulos" ? (
        <EmptyState
          icon={BarChart3}
          title="Ángulos creativos: próximamente"
          description="Cuando crees ángulos (ej: «dolor de espalda», «postparto») en tus landings, aquí verás cuál vende más con su CPA real."
        />
      ) : rows.length ? (
        <PerformanceTable rows={rows} firstColumn={cfg.first} showMeta={showMeta} />
      ) : (
        <EmptyState
          icon={BarChart3}
          title="Sin datos en este periodo"
          description={showMeta ? "Conecta Meta en Marketing para ver tus campañas, o cambia las fechas." : "Aún no hay pedidos en este periodo."}
        />
      )}
      <p className="text-xs text-muted-foreground">
        Pedidos del periodo según su fecha de creación; el gasto, según el día en que se gastó. Las ventas reales siguen tu configuración (Lima: Entregado ·
        Provincia: Cobrado, o Entregado en ambas).
      </p>
    </div>
  );
}
