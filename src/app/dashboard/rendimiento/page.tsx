import { BarChart3, Filter, Map as MapIcon, Megaphone } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { BrandIcon } from "@/components/brand-icons";
import { DateRangeFilter, rangeParams } from "@/components/dashboard/date-range-filter";
import { EmptyState, PageHeader } from "@/components/dashboard/page-header";
import { requireOwner } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { computePerformanceRow } from "@/modules/metrics";
import { refreshMetaInBackground } from "@/modules/meta/sync";
import { type DateRange, resolveRange } from "@/modules/metrics/date-range";
import { FunnelView } from "./funnel-view";
import { type PerfRow, PerformanceTable } from "./performance-table";
import { type GeoLevel, ZonesView } from "./zones-view";

export const metadata: Metadata = { title: "Rendimiento" };

/** Tres preguntas, tres pestañas: ¿qué anuncio conviene? ¿dónde se cae la venta? ¿qué zonas no entregan? */
const VIEWS = {
  anuncios: { label: "Anuncios", icon: Megaphone, description: "Lo que dice Meta junto a lo que de verdad vendiste, por campaña, anuncio, ángulo, producto o página." },
  embudo: { label: "Embudo", icon: Filter, description: "Dónde se pierden los clientes: de la visita al pedido entregado." },
  zonas: { label: "Zonas", icon: MapIcon, description: "Pedidos, entregas y utilidad por departamento, provincia y distrito." },
} as const;
type View = keyof typeof VIEWS;

const LEVELS = {
  campanas: { label: "Campañas", first: "Campaña", rpc: "campaign" },
  conjuntos: { label: "Conjuntos", first: "Conjunto", rpc: "adset" },
  anuncios: { label: "Anuncios", first: "Anuncio", rpc: "ad" },
  angulos: { label: "Ángulos", first: "Ángulo", rpc: "angle" },
  productos: { label: "Productos", first: "Producto", rpc: null },
  paginas: { label: "Páginas", first: "Página", rpc: "page" },
} as const;
type Level = keyof typeof LEVELS;

const chip = (active: boolean) => cn("rounded-full border px-3 py-1 text-sm whitespace-nowrap", active ? "border-foreground bg-foreground text-background" : "hover:bg-muted");

async function AdsView({ storeId, range, level, levelHref }: { storeId: string; range: DateRange; level: Level; levelHref: (l: Level) => string }) {
  const supabase = await createClient();
  const cfg = LEVELS[level];
  const [{ data }, { data: meta }, { data: accounts }] = await Promise.all([
    cfg.rpc
      ? supabase.rpc("get_performance", {
          p_store_id: storeId,
          p_from: range.from,
          p_to: range.to,
          p_from_date: range.startDate,
          p_to_date: range.endDate,
          p_level: cfg.rpc,
        })
      : supabase.rpc("get_product_stats", { p_store_id: storeId, p_from: range.from, p_to: range.to, p_from_date: range.startDate, p_to_date: range.endDate }),
    supabase.from("store_meta_settings").select("ad_account_id, ad_account_name, last_sync_at").eq("store_id", storeId).maybeSingle(),
    supabase.from("store_meta_accounts").select("ad_account_id, name").eq("store_id", storeId),
  ]);

  // Con varias cuentas, cada campaña/anuncio dice de qué cuenta viene
  const accountName = new Map((accounts ?? []).map((a) => [a.ad_account_id as string, (a.name as string | null) ?? a.ad_account_id]));
  const entityAccount = new Map<string, string>();
  const ids = ((data ?? []) as Record<string, unknown>[]).map((r) => String(r.key ?? "")).filter((k) => /^\d{5,30}$/.test(k));
  if (accountName.size > 1 && ids.length && (cfg.rpc === "campaign" || cfg.rpc === "adset" || cfg.rpc === "ad")) {
    const { data: ents } = await supabase.from("meta_entities").select("id, ad_account_id").eq("store_id", storeId).in("id", ids.slice(0, 500));
    for (const e of ents ?? []) if (e.ad_account_id) entityAccount.set(e.id as string, accountName.get(e.ad_account_id as string) ?? (e.ad_account_id as string));
  }

  const rows: PerfRow[] = ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    ...computePerformanceRow(r),
    key: String(r.key ?? r.product_id),
    name: String(r.name ?? r.key ?? "—"),
    subtitle: [r.adset_name, r.campaign_name, entityAccount.get(String(r.key ?? ""))].filter(Boolean).join(" · ") || null,
    status: (r.status as string | null) ?? null,
    thumbnail: (r.thumbnail_url as string | null) ?? null,
  }));
  const showMeta = cfg.rpc === "campaign" || cfg.rpc === "adset" || cfg.rpc === "ad" || cfg.rpc === "angle";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {(Object.keys(LEVELS) as Level[]).map((l) => (
            <Link key={l} href={levelHref(l)} className={chip(level === l)}>
              {LEVELS[l].label}
            </Link>
          ))}
        </div>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {meta?.ad_account_id ? (
            <>
              <BrandIcon name="meta" className="size-4" />
              {accountName.size > 1 ? `${accountName.size} cuentas` : meta.ad_account_name} · leído {meta.last_sync_at ? formatDateTime(meta.last_sync_at) : "—"}
            </>
          ) : (
            <>
              Sin cuenta de Meta: el gasto viene de Gastos.
              <Link href="/dashboard/marketing" className="inline-flex items-center gap-1 underline">
                <BrandIcon name="meta" className="size-4" /> Conectar Meta
              </Link>
            </>
          )}
        </span>
      </div>

      {rows.length ? (
        <PerformanceTable rows={rows} firstColumn={cfg.first} showMeta={showMeta} />
      ) : (
        <EmptyState
          icon={BarChart3}
          title="Sin datos en este periodo"
          description={
            level === "angulos"
              ? "Ponle un ángulo a cada landing (Editor → Ventas → Ángulo creativo) para comparar cuál vende más."
              : showMeta
                ? "Conecta Meta en Marketing para ver tus campañas, o cambia las fechas."
                : "Aún no hay pedidos en este periodo."
          }
        />
      )}
      <p className="text-xs text-muted-foreground">
        Pedidos del periodo según su fecha de creación; el gasto, según el día en que se gastó. Las ventas reales siguen tu configuración (Lima: Entregado ·
        Provincia: Cobrado, o Entregado en ambas).
      </p>
    </div>
  );
}

export default async function PerformancePage({ searchParams }: PageProps<"/dashboard/rendimiento">) {
  const sp = await searchParams;
  const view: View = typeof sp.vista === "string" && sp.vista in VIEWS ? (sp.vista as View) : "anuncios";
  const level: Level = typeof sp.nivel === "string" && sp.nivel in LEVELS ? (sp.nivel as Level) : "campanas";
  const geo: GeoLevel = sp.geo === "province" || sp.geo === "district" ? sp.geo : "department";
  const parent = typeof sp.padre === "string" && /^\d{2,4}$/.test(sp.padre) ? sp.padre : null;
  const parentName = typeof sp.nombre === "string" ? sp.nombre.slice(0, 80) : null;
  const rp = rangeParams(sp);
  const range = resolveRange(rp.rango, rp.desde, rp.hasta);
  const { store } = await requireOwner();
  refreshMetaInBackground(store.id);

  const href = (params: Record<string, string | undefined>) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries({ rango: rp.rango, desde: rp.desde, hasta: rp.hasta, ...params })) if (v) q.set(k, v);
    return `/dashboard/rendimiento?${q.toString()}`;
  };
  // Parámetros que el filtro de fechas debe conservar según la pestaña
  const keep =
    view === "anuncios"
      ? { vista: undefined, nivel: level }
      : view === "zonas"
        ? { vista: view, geo: geo !== "department" ? geo : undefined, padre: parent ?? undefined, nombre: parentName ?? undefined }
        : { vista: view };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Rendimiento" description={VIEWS[view].description} />

      <div className="flex border-b" role="tablist" aria-label="Vista">
        {(Object.keys(VIEWS) as View[]).map((v) => {
          const Icon = VIEWS[v].icon;
          return (
            <Link
              key={v}
              href={href({ vista: v === "anuncios" ? undefined : v })}
              role="tab"
              aria-selected={view === v}
              className={cn(
                "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors",
                view === v ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="size-4" />
              {VIEWS[v].label}
            </Link>
          );
        })}
      </div>

      <DateRangeFilter basePath="/dashboard/rendimiento" range={range} params={keep} />

      {view === "anuncios" ? <AdsView storeId={store.id} range={range} level={level} levelHref={(l) => href({ nivel: l })} /> : null}
      {view === "embudo" ? <FunnelView storeId={store.id} range={range} /> : null}
      {view === "zonas" ? (
        <ZonesView
          storeId={store.id}
          range={range}
          level={geo}
          parent={parent}
          parentName={parentName}
          hrefFor={(g) => href({ vista: "zonas", geo: g.geo, padre: g.padre, nombre: g.nombre })}
        />
      ) : null}
    </div>
  );
}
