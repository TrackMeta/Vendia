import { Info } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { DateRangeFilter, rangeParams } from "@/components/dashboard/date-range-filter";
import { WelcomeChecklist } from "./welcome-checklist";
import { PageHeader } from "@/components/dashboard/page-header";
import { OrderStatusBadge } from "@/components/dashboard/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireOwner } from "@/lib/auth";
import { formatDateTime, formatMoney, formatNumber, formatPercent, formatRatio } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { computeDashboardMetrics, fromOrderStats } from "@/modules/metrics";
import { resolveRange } from "@/modules/metrics/date-range";
import { parseSaleMode, REAL_SALE_MODES } from "@/modules/metrics/real-sale";
import type { OrderStatus } from "@/modules/orders/state-machine";

export const metadata: Metadata = { title: "Inicio" };

function Metric({ label, value, hint, highlight }: { label: string; value: string; hint?: string; highlight?: boolean }) {
  return (
    <div className={cn("flex flex-col gap-1 rounded-xl border p-4", highlight && "border-primary/40 bg-primary/5")}>
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-2xl font-semibold tabular-nums">{value}</span>
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </div>
  );
}

export default async function DashboardHome({ searchParams }: PageProps<"/dashboard">) {
  const sp = await searchParams;
  const rp = rangeParams(sp);
  const range = resolveRange(rp.rango, rp.desde, rp.hasta);
  const { store } = await requireOwner();
  const supabase = await createClient();

  const [{ data: stats }, { data: recent }, { data: expenseTotals }, { data: settings }] = await Promise.all([
    supabase.rpc("get_order_stats", { p_store_id: store.id, p_from: range.from, p_to: range.to }),
    supabase
      .from("orders")
      .select("id, order_number, created_at, customer_name, total, status, district_name")
      .eq("store_id", store.id)
      .order("created_at", { ascending: false })
      .limit(8),
    supabase.rpc("get_expense_totals", { p_store_id: store.id, p_from: range.startDate, p_to: range.endDate }),
    supabase.from("store_settings").select("real_sale_mode").eq("store_id", store.id).single(),
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

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={`Hola, ${store.name}`} description={`Pedidos creados en: ${range.label}`} />

      <DateRangeFilter basePath="/dashboard" range={range} />

      <Suspense fallback={null}>
        <WelcomeChecklist storeId={store.id} />
      </Suspense>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">Ventas</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Metric label="Revenue real" value={formatMoney(m.totals.revenue)} hint={`Venta real: ${REAL_SALE_MODES[saleMode]}`} highlight />
          <Metric label="Pedidos generados" value={formatNumber(m.counts.orders)} hint={`Valor: ${formatMoney(m.counts.ordersValue)} (no es venta)`} />
          <Metric label="Confirmados" value={formatNumber(m.counts.confirmed)} hint={`${formatPercent(m.rates.confirmationRate)} de los pedidos`} />
          <Metric label="Enviados" value={formatNumber(m.counts.shipped)} />
          <Metric label="Ventas reales" value={formatNumber(m.counts.delivered)} hint={`${formatPercent(m.rates.effectiveRate)} de los pedidos`} highlight />
          <Metric label="Cancelados" value={formatNumber(m.counts.cancelled)} hint={formatPercent(m.rates.cancellationRate)} />
          <Metric label="No entregados / devueltos" value={formatNumber(m.counts.failed)} />
          <Metric label="En proceso" value={formatNumber(m.counts.inProgress)} hint="Aún pueden convertirse en venta" />
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">Marketing</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          <Metric
            label="Gasto publicitario"
            value={formatMoney(adSpend)}
            hint={`Meta: ${formatMoney(metaSpend)}${Number(expenses.igv ?? 0) > 0 ? " · con IGV" : ""}`}
          />
          <Metric label="CPA pedido" value={formatMoney(m.cpa.perOrder)} />
          <Metric
            label="Pedidos atribuidos"
            value={formatPercent(m.rates.attributionRate)}
            hint={`${formatNumber(m.counts.attributed ?? 0)} con campaña`}
          />
          <Metric label="CPA real" value={formatMoney(m.cpa.perDelivered)} hint="Gasto ÷ ventas reales" highlight />
          <Metric label="ROAS (pedidos)" value={formatRatio(m.roas.orders)} />
          <Metric label="ROAS real" value={formatRatio(m.roas.real)} highlight />
        </div>
        {adSpend === 0 ? (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Info className="size-3.5" /> Sin gasto registrado en este periodo.{" "}
            <Link href="/dashboard/gastos" className="underline">
              Registra o importa tu gasto de Meta Ads
            </Link>{" "}
            para ver tu CPA y ROAS reales.
          </p>
        ) : null}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">Rentabilidad</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          <Metric label="Revenue" value={formatMoney(m.totals.revenue)} />
          <Metric label="Costo de productos" value={formatMoney(m.totals.productCost)} />
          <Metric label="Envíos y embalaje" value={formatMoney(m.totals.shippingCost)} />
          <Metric label="Publicidad" value={formatMoney(adSpend)} />
          <Metric label="Otros gastos" value={formatMoney(otherExpenses)} />
          <Metric label="Utilidad real" value={formatMoney(m.profit)} hint={`Margen ${formatPercent(m.margin)}`} highlight />
        </div>
      </section>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Últimos pedidos</CardTitle>
          <Link href="/dashboard/pedidos" className="text-sm text-muted-foreground hover:underline">
            Ver todos
          </Link>
        </CardHeader>
        <CardContent>
          {recent?.length ? (
            <ul className="divide-y">
              {recent.map((o) => (
                <li key={o.id}>
                  <Link href={`/dashboard/pedidos/${o.id}`} className="flex items-center justify-between gap-3 py-2.5 text-sm hover:bg-muted/40">
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate font-medium">
                        #{o.order_number} · {o.customer_name}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatDateTime(o.created_at)} · {o.district_name}
                      </span>
                    </span>
                    <span className="flex items-center gap-3">
                      <span className="tabular-nums">{formatMoney(o.total)}</span>
                      <OrderStatusBadge status={o.status as OrderStatus} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-6 text-center text-sm text-muted-foreground">Aún no hay pedidos.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
