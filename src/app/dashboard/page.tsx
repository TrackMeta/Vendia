import { ArrowRight, Info, ShoppingBag } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { DateRangeFilter, rangeParams } from "@/components/dashboard/date-range-filter";
import { KpiCard, MiniStat } from "@/components/dashboard/metric";
import { EmptyState } from "@/components/dashboard/page-header";
import { OrderStatusBadge } from "@/components/dashboard/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireOwner } from "@/lib/auth";
import { formatDateTime, formatMoney, formatNumber, formatPercent, formatRatio } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { computeDashboardMetrics, fromOrderStats } from "@/modules/metrics";
import { buildSeries, type DailyRow } from "@/modules/metrics/daily";
import { refreshMetaInBackground } from "@/modules/meta/sync";
import { resolveRange } from "@/modules/metrics/date-range";
import { parseSaleMode, REAL_SALE_MODES } from "@/modules/metrics/real-sale";
import type { OrderStatus } from "@/modules/orders/state-machine";
import { DailyChart } from "./daily-chart";
import { WelcomeChecklist } from "./welcome-checklist";

export const metadata: Metadata = { title: "Inicio" };

const HELP = {
  roas: "Retorno de la publicidad: cuántos soles vendiste (ventas reales, no pedidos) por cada sol invertido en anuncios. 3x = vendiste S/ 3 por cada S/ 1.",
  roasOrders: "Igual que el ROAS real pero con el valor de todos los pedidos, aunque luego se cancelen. Siempre sale más alto: no lo uses para decidir.",
  cpa: "Costo por venta: cuánto gastaste en anuncios por cada venta real (pedido entregado o cobrado).",
  cpaOrder: "Costo por pedido: gasto en anuncios ÷ pedidos generados. Sirve para ver qué tan barato llegan los pedidos.",
  effective: "De cada 100 pedidos, cuántos terminaron en venta real.",
  profit: "Ingreso real menos costo de productos, envíos y embalaje, publicidad y otros gastos.",
};

function GroupCard({ title, children, footer }: { title: string; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col divide-y">{children}</CardContent>
      {footer}
    </Card>
  );
}

export default async function DashboardHome({ searchParams }: PageProps<"/dashboard">) {
  const sp = await searchParams;
  const rp = rangeParams(sp);
  const range = resolveRange(rp.rango, rp.desde, rp.hasta);
  const { store } = await requireOwner();
  refreshMetaInBackground(store.id);
  const supabase = await createClient();

  const [{ data: stats }, { data: recent }, { data: expenseTotals }, { data: settings }, { data: daily, error: dailyError }] = await Promise.all([
    supabase.rpc("get_order_stats", { p_store_id: store.id, p_from: range.from, p_to: range.to }),
    supabase
      .from("orders")
      .select("id, order_number, created_at, customer_name, total, status, district_name")
      .eq("store_id", store.id)
      .order("created_at", { ascending: false })
      .limit(6),
    supabase.rpc("get_expense_totals", { p_store_id: store.id, p_from: range.startDate, p_to: range.endDate }),
    supabase.from("store_settings").select("real_sale_mode").eq("store_id", store.id).single(),
    supabase.rpc("get_daily_orders", { p_store_id: store.id, p_from: range.from, p_to: range.to }),
  ]);
  const saleMode = parseSaleMode(settings?.real_sale_mode);

  const base = fromOrderStats((stats ?? {}) as Record<string, number>);
  const expenses = (expenseTotals ?? {}) as { ad_spend?: number; meta_spend?: number; igv?: number; other_expenses?: number };
  const adSpend = Number(expenses.ad_spend ?? 0);
  const metaSpend = Number(expenses.meta_spend ?? 0);
  const otherExpenses = Number(expenses.other_expenses ?? 0);
  const m = computeDashboardMetrics(base.counts, {
    revenue: base.revenue,
    productCost: base.productCost,
    shippingCost: base.shippingCost,
    adSpend,
    otherExpenses,
  });
  // Si la función del gráfico aún no está en la base (falta correr el SQL), el Inicio sigue funcionando sin él
  const series = dailyError ? null : buildSeries((daily ?? []) as DailyRow[], range.startDate, range.endDate);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Hola, {store.name}</h1>
          <p className="text-sm text-muted-foreground">Pedidos creados en: {range.label}</p>
        </div>
        <DateRangeFilter basePath="/dashboard" range={range} />
      </div>

      <Suspense fallback={null}>
        <WelcomeChecklist storeId={store.id} />
      </Suspense>

      {/* Las 4 cifras que importan */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Resumen">
        <KpiCard featured label="Utilidad real" value={formatMoney(m.profit)} sub={`Margen ${formatPercent(m.margin)}`} help={HELP.profit} />
        <KpiCard
          label="Ventas reales"
          value={formatNumber(m.counts.delivered)}
          sub={`${formatPercent(m.rates.effectiveRate)} de ${formatNumber(m.counts.orders)} pedidos`}
          help={HELP.effective}
        />
        <KpiCard label="Ingreso real" value={formatMoney(m.totals.revenue)} sub={`Venta real: ${REAL_SALE_MODES[saleMode]}`} />
        <KpiCard label="ROAS real" value={formatRatio(m.roas.real)} sub={`CPA real ${formatMoney(m.cpa.perDelivered)}`} help={HELP.roas} />
      </section>

      {series ? (
        <Card>
          <CardContent>
            {series.some((p) => p.orders > 0) ? (
              <DailyChart points={series} />
            ) : (
              <p className="py-10 text-center text-sm text-muted-foreground">Cuando entren pedidos en este periodo, aquí verás cómo van día a día.</p>
            )}
          </CardContent>
        </Card>
      ) : null}

      {/* Detalle en grupos compactos */}
      <section className="grid gap-3 md:grid-cols-3">
        <GroupCard title="Pedidos">
          <MiniStat label="Generados" value={formatNumber(m.counts.orders)} hint={formatMoney(m.counts.ordersValue)} />
          <MiniStat label="Confirmados" value={formatNumber(m.counts.confirmed)} hint={formatPercent(m.rates.confirmationRate)} />
          <MiniStat label="Enviados" value={formatNumber(m.counts.shipped)} />
          <MiniStat label="En proceso" value={formatNumber(m.counts.inProgress)} />
          <MiniStat label="Cancelados" value={formatNumber(m.counts.cancelled)} hint={formatPercent(m.rates.cancellationRate)} />
          <MiniStat label="No entregados / devueltos" value={formatNumber(m.counts.failed)} />
        </GroupCard>
        <GroupCard
          title="Publicidad"
          footer={
            adSpend === 0 ? (
              <p className="flex items-start gap-1.5 px-3 text-xs text-muted-foreground">
                <Info className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  Sin gasto en este periodo.{" "}
                  <Link href="/dashboard/marketing" className="underline">
                    Conecta Meta
                  </Link>{" "}
                  o{" "}
                  <Link href="/dashboard/gastos" className="underline">
                    registra tu gasto
                  </Link>
                  .
                </span>
              </p>
            ) : null
          }
        >
          <MiniStat label="Gasto en anuncios" value={formatMoney(adSpend)} hint={metaSpend ? `Meta ${formatMoney(metaSpend)}${Number(expenses.igv ?? 0) > 0 ? " · con IGV" : ""}` : undefined} />
          <MiniStat label="CPA real" value={formatMoney(m.cpa.perDelivered)} help={HELP.cpa} strong />
          <MiniStat label="CPA pedido" value={formatMoney(m.cpa.perOrder)} help={HELP.cpaOrder} />
          <MiniStat label="ROAS pedidos" value={formatRatio(m.roas.orders)} help={HELP.roasOrders} />
          <MiniStat label="Pedidos con campaña" value={formatPercent(m.rates.attributionRate)} hint={formatNumber(m.counts.attributed ?? 0)} />
        </GroupCard>
        <GroupCard title="Rentabilidad">
          <MiniStat label="Ingreso real" value={formatMoney(m.totals.revenue)} />
          <MiniStat label="Costo de productos" value={`− ${formatMoney(m.totals.productCost)}`} />
          <MiniStat label="Envíos y embalaje" value={`− ${formatMoney(m.totals.shippingCost)}`} />
          <MiniStat label="Publicidad" value={`− ${formatMoney(adSpend)}`} />
          <MiniStat label="Otros gastos" value={`− ${formatMoney(otherExpenses)}`} />
          <MiniStat label="Utilidad real" value={formatMoney(m.profit)} strong />
        </GroupCard>
      </section>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Últimos pedidos</CardTitle>
          <Link href="/dashboard/pedidos" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            Ver todos <ArrowRight className="size-3.5" />
          </Link>
        </CardHeader>
        <CardContent>
          {recent?.length ? (
            <ul className="-mx-2 divide-y">
              {recent.map((o) => (
                <li key={o.id}>
                  <Link href={`/dashboard/pedidos/${o.id}`} className="flex items-center justify-between gap-3 rounded-md px-2 py-2.5 text-sm hover:bg-muted/60">
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate font-medium">
                        #{o.order_number} · {o.customer_name}
                      </span>
                      <span className="truncate text-xs text-muted-foreground">
                        {formatDateTime(o.created_at)} · {o.district_name}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-3">
                      <span className="hidden tabular-nums sm:inline">{formatMoney(o.total)}</span>
                      <OrderStatusBadge status={o.status as OrderStatus} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={ShoppingBag}
              title="Aún no tienes pedidos"
              description="Publica tu landing y pega su enlace en tu anuncio. Cada pedido aparecerá aquí al instante."
              action={
                <Link href="/dashboard/landings" className="text-sm font-medium text-primary hover:underline">
                  Ir a mis landings
                </Link>
              }
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
