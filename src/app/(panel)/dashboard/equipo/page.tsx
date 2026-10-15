import type { Metadata } from "next";
import { PageHeader } from "@/components/dashboard/page-header";
import { SimpleBadge } from "@/components/dashboard/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireOwner } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { DateRangeFilter, rangeParams } from "@/components/dashboard/date-range-filter";
import { resolveRange } from "@/modules/metrics/date-range";
import { type CommissionRow, CommissionsTable, MemberSettings, type PaymentRow } from "./member-settings";
import { InviteForm, RemoveMemberButton, RevokeInvitationButton } from "./team-controls";
import { type TeamMetricRow, TeamMetricsTable } from "./team-metrics";

export const metadata: Metadata = { title: "Equipo" };

type Member = {
  user_id: string;
  email: string;
  full_name: string | null;
  role: "owner" | "staff";
  joined_at: string;
  color: string | null;
  commission_lima: number | null;
  commission_province: number | null;
};

export default async function TeamPage({ searchParams }: PageProps<"/dashboard/equipo">) {
  const rp = rangeParams(await searchParams);
  const range = resolveRange(rp.rango, rp.desde, rp.hasta);
  const { user, store } = await requireOwner();
  const supabase = await createClient();
  const [{ data: team }, { data: invitations }, { data: commissions }, { data: payments }, { data: metrics }] = await Promise.all([
    supabase.rpc("get_store_team", { p_store_id: store.id }),
    supabase
      .from("store_invitations")
      .select("id, email, created_at, expires_at, accepted_at")
      .eq("store_id", store.id)
      .is("accepted_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false }),
    supabase.rpc("get_commissions", { p_store_id: store.id }),
    supabase.from("commission_payments").select("id, user_id, amount, paid_on, note").eq("store_id", store.id).order("paid_on", { ascending: false }).limit(500),
    supabase.rpc("get_team_metrics", { p_store_id: store.id, p_from: range.from, p_to: range.to }),
  ]);
  const members = (team ?? []) as Member[];
  // Solo invitaciones vigentes (la consulta ya filtra por fecha en la base de datos)
  const pending = invitations ?? [];

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        title="Equipo"
        description="Invita a quienes te ayudan a confirmar y despachar. Los confirmadores ven pedidos, logística y clientes, pero no gastos, configuración ni finanzas."
      />

      <Card>
        <CardHeader>
          <CardTitle>Invitar confirmador</CardTitle>
          <CardDescription>Se genera un enlace que vence en 7 días. Envíalo por WhatsApp; la persona entra o se registra con ese correo y acepta.</CardDescription>
        </CardHeader>
        <CardContent>
          <InviteForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Miembros ({members.length})</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col divide-y">
          {members.map((m) => (
            <div key={m.user_id} className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-sm">
              <div className="flex min-w-0 flex-col">
                <span className="flex items-center gap-2 font-medium">
                  {m.full_name || m.email}
                  {m.user_id === user.id ? <span className="text-xs text-muted-foreground">(tú)</span> : null}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {m.email} · desde {formatDateTime(m.joined_at)}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <SimpleBadge tone={m.role === "owner" ? "success" : "info"}>{m.role === "owner" ? "Dueño" : "Confirmador"}</SimpleBadge>
                {m.role !== "owner" ? <RemoveMemberButton userId={m.user_id} name={m.full_name || m.email} /> : null}
              </div>
              <div className="w-full">
                <MemberSettings
                  userId={m.user_id}
                  color={m.color}
                  commissionLima={Number(m.commission_lima ?? 0)}
                  commissionProvince={Number(m.commission_province ?? 0)}
                />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Comisiones</CardTitle>
          <CardDescription>
            Se ganan al confirmar un pedido (según la comisión de cada persona) y se anulan si el pedido se cancela, no se entrega o se devuelve.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CommissionsTable
            rows={((commissions ?? []) as CommissionRow[]).map((r) => ({ ...r, generated: Number(r.generated), annulled: Number(r.annulled), paid: Number(r.paid) }))}
            payments={((payments ?? []) as PaymentRow[]).map((p) => ({ ...p, amount: Number(p.amount) }))}
            canManage
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-col gap-3">
          <div>
            <CardTitle>Rendimiento del equipo</CardTitle>
            <CardDescription>Pedidos que llegaron en el periodo: quién los trabajó, confirmó y cuántos terminaron en venta real.</CardDescription>
          </div>
          <DateRangeFilter basePath="/dashboard/equipo" range={range} />
        </CardHeader>
        <CardContent>
          <TeamMetricsTable rows={(metrics ?? []) as TeamMetricRow[]} />
        </CardContent>
      </Card>

      {pending.length ? (
        <Card>
          <CardHeader>
            <CardTitle>Invitaciones pendientes</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col divide-y">
            {pending.map((i) => (
              <div key={i.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <span className="flex flex-col">
                  <span className="font-medium">{i.email}</span>
                  <span className="text-xs text-muted-foreground">Vence {formatDateTime(i.expires_at)}</span>
                </span>
                <RevokeInvitationButton id={i.id} />
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
