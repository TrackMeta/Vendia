import type { Metadata } from "next";
import { DateRangeFilter, rangeParams } from "@/components/dashboard/date-range-filter";
import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireStore } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { resolveRange } from "@/modules/metrics/date-range";
import { type CommissionRow, CommissionsTable, type PaymentRow } from "../equipo/member-settings";
import { type TeamMetricRow, TeamMetricsTable } from "../equipo/team-metrics";

export const metadata: Metadata = { title: "Mi rendimiento" };

/** Lo que ve el confirmador de sí mismo: sus confirmados, ventas reales y comisiones (nada de los demás). */
export default async function MyPerformancePage({ searchParams }: PageProps<"/dashboard/mi-rendimiento">) {
  const rp = rangeParams(await searchParams);
  const range = resolveRange(rp.rango, rp.desde, rp.hasta);
  const { user, store } = await requireStore();
  const supabase = await createClient();
  // Las funciones de la base solo devuelven la fila propia cuando no eres el dueño
  const [{ data: metrics }, { data: commissions }, { data: payments }] = await Promise.all([
    supabase.rpc("get_team_metrics", { p_store_id: store.id, p_from: range.from, p_to: range.to }),
    supabase.rpc("get_commissions", { p_store_id: store.id }),
    supabase.from("commission_payments").select("id, user_id, amount, paid_on, note").eq("store_id", store.id).eq("user_id", user.id).order("paid_on", { ascending: false }),
  ]);
  const mine = ((metrics ?? []) as TeamMetricRow[]).filter((r) => r.user_id === user.id);
  const myCommission = ((commissions ?? []) as CommissionRow[]).filter((r) => r.user_id === user.id);

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader title="Mi rendimiento" description="Tus pedidos confirmados, cuántos terminaron en venta real y tus comisiones." />
      <Card>
        <CardHeader className="flex flex-col gap-3">
          <CardTitle>Mis números</CardTitle>
          <DateRangeFilter basePath="/dashboard/mi-rendimiento" range={range} />
        </CardHeader>
        <CardContent>
          <TeamMetricsTable rows={mine} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Mis comisiones</CardTitle>
          <CardDescription>Ganas comisión por cada pedido que confirmas. Si el pedido se cancela, no se entrega o se devuelve, esa comisión se anula.</CardDescription>
        </CardHeader>
        <CardContent>
          {myCommission.length ? (
            <CommissionsTable
              rows={myCommission.map((r) => ({ ...r, generated: Number(r.generated), annulled: Number(r.annulled), paid: Number(r.paid) }))}
              payments={((payments ?? []) as PaymentRow[]).map((p) => ({ ...p, amount: Number(p.amount) }))}
              canManage={false}
            />
          ) : (
            <p className="text-sm text-muted-foreground">Aún no tienes comisiones.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
