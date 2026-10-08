import { ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { DateRangeFilter, rangeParams } from "@/components/dashboard/date-range-filter";
import { PageHeader } from "@/components/dashboard/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireOwner } from "@/lib/auth";
import { formatMoney, formatNumber, formatPercent, formatRatio } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { buildFunnel, computeRowMetrics } from "@/modules/metrics";
import { resolveRange } from "@/modules/metrics/date-range";

export const metadata: Metadata = { title: "Analítica" };

const VIEWS = { funnel: "Funnel", campanas: "Campañas", productos: "Productos", geografia: "Geografía" } as const;
type View = keyof typeof VIEWS;

type Row = ReturnType<typeof computeRowMetrics> & { label: string; sublabel?: string; href?: string };

function profitClass(v: number) {
  return v < 0 ? "text-destructive" : v > 0 ? "text-emerald-600 dark:text-emerald-400" : "";
}

function MetricsTable({ rows, firstColumn, showVisits, showSpend = true }: { rows: Row[]; firstColumn: string; showVisits?: boolean; showSpend?: boolean }) {
  if (!rows.length) return <p className="rounded-xl border border-dashed px-6 py-12 text-center text-sm text-muted-foreground">Sin datos en este periodo.</p>;
  return (
    <div className="overflow-x-auto rounded-xl border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{firstColumn}</TableHead>
            {showVisits ? <TableHead className="text-right">Visitas</TableHead> : null}
            {showSpend ? <TableHead className="text-right">Gasto</TableHead> : null}
            <TableHead className="text-right">Pedidos</TableHead>
            <TableHead className="text-right">Confirm.</TableHead>
            <TableHead className="text-right">Ventas</TableHead>
            <TableHead className="text-right" title="Ventas reales ÷ pedidos enviados">Efectividad</TableHead>
            <TableHead className="text-right">Revenue real</TableHead>
            {showSpend ? <TableHead className="text-right">CPA pedido</TableHead> : null}
            {showSpend ? <TableHead className="text-right">CPA real</TableHead> : null}
            {showSpend ? <TableHead className="text-right">ROAS real</TableHead> : null}
            <TableHead className="text-right">Utilidad</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.label + (r.sublabel ?? "")}>
              <TableCell>
                <div className="flex max-w-56 flex-col">
                  {r.href ? (
                    <Link href={r.href} className="flex items-center gap-1 font-medium hover:underline">
                      {r.label} <ChevronRight className="size-3.5" />
                    </Link>
                  ) : (
                    <span className="truncate font-medium">{r.label}</span>
                  )}
                  {r.sublabel ? <span className="truncate text-xs text-muted-foreground">{r.sublabel}</span> : null}
                </div>
              </TableCell>
              {showVisits ? <TableCell className="text-right tabular-nums">{formatNumber(r.visits ?? 0)}</TableCell> : null}
              {showSpend ? <TableCell className="text-right tabular-nums">{formatMoney(r.ad_spend ?? 0)}</TableCell> : null}
              <TableCell className="text-right tabular-nums">{r.orders}</TableCell>
              <TableCell className="text-right tabular-nums">{r.confirmed}</TableCell>
              <TableCell className="text-right tabular-nums">{r.delivered}</TableCell>
              <TableCell className="text-right tabular-nums">{formatPercent(r.deliveryRate)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatMoney(r.revenue)}</TableCell>
              {showSpend ? <TableCell className="text-right tabular-nums">{formatMoney(r.cpa.perOrder)}</TableCell> : null}
              {showSpend ? <TableCell className="text-right font-medium tabular-nums">{formatMoney(r.cpa.perDelivered)}</TableCell> : null}
              {showSpend ? <TableCell className="text-right tabular-nums">{formatRatio(r.roas.real)}</TableCell> : null}
              <TableCell className={cn("text-right font-medium tabular-nums", profitClass(r.profit))}>{formatMoney(r.profit)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export default async function AnalyticsPage({ searchParams }: PageProps<"/dashboard/analitica">) {
  const sp = await searchParams;
  const rp = rangeParams(sp);
  const range = resolveRange(rp.rango, rp.desde, rp.hasta);
  const view: View = typeof sp.vista === "string" && sp.vista in VIEWS ? (sp.vista as View) : "funnel";
  const level = sp.nivel === "province" || sp.nivel === "district" ? sp.nivel : "department";
  const parent = typeof sp.padre === "string" && /^\d{2,4}$/.test(sp.padre) ? sp.padre : null;
  const parentName = typeof sp.nombre === "string" ? sp.nombre.slice(0, 80) : null;

  const { store } = await requireOwner();
  const supabase = await createClient();
  const baseParams = { vista: view, rango: rp.rango, desde: rp.desde, hasta: rp.hasta };
  const qs = (extra: Record<string, string | undefined>) => {
    const s = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...baseParams, ...extra })) if (v) s.set(k, v);
    return `/dashboard/analitica?${s.toString()}`;
  };

  let content: React.ReactNode = null;

  if (view === "funnel") {
    const { data } = await supabase.rpc("get_funnel", { p_store_id: store.id, p_from: range.from, p_to: range.to });
    const steps = buildFunnel((data ?? {}) as Record<string, unknown>);
    const max = Math.max(...steps.map((s) => s.value), 1);
    let worst: { label: string; rate: number } | null = null;
    for (const s of steps.slice(1)) {
      if (s.rateFromPrevious !== null && (!worst || s.rateFromPrevious < worst.rate) && s.key !== "view_content") worst = { label: s.label, rate: s.rateFromPrevious };
    }
    content = (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1 rounded-xl border p-4">
          {steps.map((s, i) => (
            <div key={s.key} className="flex flex-col gap-1">
              {i > 0 ? (
                <div className="pl-2 text-xs text-muted-foreground">↓ {s.rateFromPrevious === null ? "—" : formatPercent(s.rateFromPrevious)}</div>
              ) : null}
              <div className="flex items-center gap-3">
                <span className="w-40 shrink-0 text-sm">{s.label}</span>
                <div className="h-7 flex-1 overflow-hidden rounded-md bg-muted">
                  <div
                    className={cn("h-full rounded-md", i >= 6 ? "bg-emerald-500" : i >= 3 ? "bg-primary" : "bg-sky-500")}
                    style={{ width: `${Math.max((s.value / max) * 100, s.value ? 1.5 : 0)}%` }}
                  />
                </div>
                <span className="w-20 shrink-0 text-right font-semibold tabular-nums">{formatNumber(s.value)}</span>
              </div>
            </div>
          ))}
        </div>
        {worst ? (
          <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
            La mayor caída está en <b>{worst.label}</b> ({formatPercent(worst.rate)} de la etapa anterior). Ahí es donde más dinero estás perdiendo.
          </p>
        ) : null}
        <p className="text-xs text-muted-foreground">
          Visitas, vistas y formularios se cuentan como visitantes únicos por día. Los pedidos son los creados en el periodo y lo que lograron después.
        </p>
      </div>
    );
  }

  if (view === "campanas") {
    const { data } = await supabase.rpc("get_campaign_stats", {
      p_store_id: store.id,
      p_from: range.from,
      p_to: range.to,
      p_from_date: range.startDate,
      p_to_date: range.endDate,
    });
    const rows: Row[] = ((data ?? []) as Record<string, unknown>[]).map((r) => ({
      ...computeRowMetrics(r),
      label: String(r.campaign_name ?? (r.campaign_key === "(directo)" ? "Directo / orgánico" : r.campaign_key)),
      sublabel: r.campaign_id ? `ID ${r.campaign_id}${r.source ? ` · ${r.source}` : ""}` : r.source ? String(r.source) : undefined,
    }));
    content = (
      <div className="flex flex-col gap-3">
        <MetricsTable rows={rows} firstColumn="Campaña" />
        <p className="text-xs text-muted-foreground">
          El gasto por campaña viene de Gastos (importa tu reporte de Meta Ads con el «Identificador de la campaña»). Los pedidos se asignan por el
          campaign_id de la URL del anuncio (ver Marketing → Plantilla de URL).
        </p>
      </div>
    );
  }

  if (view === "productos") {
    const { data } = await supabase.rpc("get_product_stats", {
      p_store_id: store.id,
      p_from: range.from,
      p_to: range.to,
      p_from_date: range.startDate,
      p_to_date: range.endDate,
    });
    const rows: Row[] = ((data ?? []) as Record<string, unknown>[]).map((r) => ({ ...computeRowMetrics(r), label: String(r.name) }));
    content = <MetricsTable rows={rows} firstColumn="Producto" showVisits />;
  }

  if (view === "geografia") {
    const { data } = await supabase.rpc("get_geo_stats", {
      p_store_id: store.id,
      p_from: range.from,
      p_to: range.to,
      p_level: level,
      p_parent: parent,
    });
    const nextLevel = level === "department" ? "province" : level === "province" ? "district" : null;
    const rows: Row[] = ((data ?? []) as Record<string, unknown>[]).map((r) => ({
      ...computeRowMetrics(r),
      label: String(r.name),
      sublabel: `${r.cancelled ?? 0} cancelados · ${r.failed ?? 0} no entregados`,
      href: nextLevel ? qs({ nivel: nextLevel, padre: String(r.code), nombre: String(r.name) }) : undefined,
    }));
    content = (
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-1 text-sm">
          <Link href={qs({})} className={level === "department" ? "font-semibold" : "text-muted-foreground hover:underline"}>
            Departamentos
          </Link>
          {parent ? (
            <>
              <ChevronRight className="size-3.5 text-muted-foreground" />
              <span className="font-semibold">{parentName ?? parent}</span>
              <span className="text-muted-foreground">({level === "province" ? "provincias" : "distritos"})</span>
            </>
          ) : null}
        </div>
        <MetricsTable rows={rows} firstColumn={level === "department" ? "Departamento" : level === "province" ? "Provincia" : "Distrito"} showSpend={false} />
        <p className="text-xs text-muted-foreground">Detecta distritos con alta cancelación o baja tasa de entrega para ajustar tu segmentación o pedir adelanto.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Analítica" description={`¿Dónde se pierde el dinero y qué te deja utilidad real? · ${range.label}`} />
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {(Object.keys(VIEWS) as View[]).map((v) => (
          <Link
            key={v}
            href={qs({ vista: v })}
            className={cn("rounded-full border px-3 py-1 text-sm whitespace-nowrap", view === v ? "border-foreground bg-foreground text-background" : "hover:bg-muted")}
          >
            {VIEWS[v]}
          </Link>
        ))}
      </div>
      <DateRangeFilter basePath="/dashboard/analitica" range={range} params={{ vista: view, nivel: level !== "department" ? level : undefined, padre: parent ?? undefined, nombre: parentName ?? undefined }} />
      {content}
    </div>
  );
}
