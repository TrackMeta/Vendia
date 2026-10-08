import { ArrowRight, Info } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/dashboard/page-header";
import { OrderStatusBadge } from "@/components/dashboard/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireStore } from "@/lib/auth";
import { formatDateTime, formatMoney, formatNumber, formatPercent, formatRatio } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { computeDashboardMetrics, fromOrderStats } from "@/modules/metrics";
import { RANGE_PRESETS, resolveRange } from "@/modules/metrics/date-range";
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
  const range = resolveRange(
    typeof sp.rango === "string" ? sp.rango : undefined,
    typeof sp.desde === "string" ? sp.desde : undefined,
    typeof sp.hasta === "string" ? sp.hasta : undefined,
  );
  const { store } = await requireStore();
  const supabase = await createClient();

  const [{ data: stats }, { data: recent }, { count: landingsCount }] = await Promise.all([
    supabase.rpc("get_order_stats", { p_store_id: store.id, p_from: range.from, p_to: range.to }),
    supabase
      .from("orders")
      .select("id, order_number, created_at, customer_name, total, status, district_name")
      .eq("store_id", store.id)
      .order("created_at", { ascending: false })
      .limit(8),
    supabase.from("landing_pages").select("id", { count: "exact", head: true }).eq("store_id", store.id).eq("status", "published"),
  ]);

  const base = fromOrderStats((stats ?? {}) as Record<string, number>);
  // Gasto publicitario y otros gastos: módulo de Gastos (Fase 5). Hasta entonces = 0.
  const adSpend = 0;
  const otherExpenses = 0;
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

      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
        {(Object.keys(RANGE_PRESETS) as (keyof typeof RANGE_PRESETS)[])
          .filter((p) => p !== "personalizado")
          .map((p) => (
            <Link
              key={p}
              href={`/dashboard?rango=${p}`}
              className={cn(
                "rounded-full border px-3 py-1 text-sm whitespace-nowrap",
                range.preset === p ? "border-foreground bg-foreground text-background" : "hover:bg-muted",
              )}
            >
              {RANGE_PRESETS[p]}
            </Link>
          ))}
        <form className="flex items-center gap-1.5">
          <input type="hidden" name="rango" value="personalizado" />
          <input type="date" name="desde" defaultValue={range.startDate} className="h-8 rounded-md border bg-transparent px-2 text-sm" aria-label="Desde" />
          <input type="date" name="hasta" defaultValue={range.endDate} className="h-8 rounded-md border bg-transparent px-2 text-sm" aria-label="Hasta" />
          <button type="submit" className="h-8 rounded-md border px-2 text-sm hover:bg-muted">
            Aplicar
          </button>
        </form>
      </div>

      {!landingsCount ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
            <div>
              <p className="font-medium">Empieza en 3 pasos</p>
              <p className="text-sm text-muted-foreground">1. Crea un producto · 2. Crea su landing · 3. Publícala y pega el link en Meta Ads.</p>
            </div>
            <Link href="/dashboard/productos/nuevo" className="flex items-center gap-1 text-sm font-medium underline">
              Crear producto <ArrowRight className="size-4" />
            </Link>
          </CardContent>
        </Card>
      ) : null}

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">Ventas</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Metric label="Revenue cobrado (entregados)" value={formatMoney(m.totals.revenue)} highlight />
          <Metric label="Pedidos generados" value={formatNumber(m.counts.orders)} hint={`Valor: ${formatMoney(m.counts.ordersValue)} (no es venta)`} />
          <Metric label="Confirmados" value={formatNumber(m.counts.confirmed)} hint={`${formatPercent(m.rates.confirmationRate)} de los pedidos`} />
          <Metric label="Enviados" value={formatNumber(m.counts.shipped)} />
          <Metric label="Entregados" value={formatNumber(m.counts.delivered)} hint={`Tasa de entrega ${formatPercent(m.rates.deliveryRate)}`} highlight />
          <Metric label="Cancelados" value={formatNumber(m.counts.cancelled)} hint={formatPercent(m.rates.cancellationRate)} />
          <Metric label="No entregados / devueltos" value={formatNumber(m.counts.failed)} />
          <Metric label="En proceso" value={formatNumber(m.counts.inProgress)} hint="Aún pueden convertirse en venta" />
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">Marketing</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          <Metric label="Gasto Meta Ads" value={formatMoney(adSpend)} />
          <Metric label="CPA pedido" value={formatMoney(m.cpa.perOrder)} />
          <Metric label="CPA confirmado" value={formatMoney(m.cpa.perConfirmed)} />
          <Metric label="CPA entregado" value={formatMoney(m.cpa.perDelivered)} highlight />
          <Metric label="ROAS (pedidos)" value={formatRatio(m.roas.orders)} />
          <Metric label="ROAS real" value={formatRatio(m.roas.real)} highlight />
        </div>
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Info className="size-3.5" /> El gasto publicitario se registrará en el módulo de Gastos (próxima fase). Mientras tanto el CPA y el ROAS se
          muestran como «—».
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">Rentabilidad</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Metric label="Revenue" value={formatMoney(m.totals.revenue)} />
          <Metric label="Costo de productos" value={formatMoney(m.totals.productCost)} />
          <Metric label="Costo de envíos" value={formatMoney(m.totals.shippingCost)} />
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
