import { ArrowLeft, ShieldAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { OrderStatusBadge, SimpleBadge } from "@/components/dashboard/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireUser } from "@/lib/auth";
import { formatDateTime, formatMoney, formatNumber } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import type { OrderStatus } from "@/modules/orders/state-machine";
import { StoreStatusButton } from "./store-status-button";

export const metadata: Metadata = { title: "Admin" };

const TABS = { tiendas: "Tiendas", usuarios: "Usuarios", pedidos: "Pedidos", errores: "Errores" } as const;
type Tab = keyof typeof TABS;

type StoreRow = { id: string; name: string; slug: string; status: "active" | "blocked"; created_at: string; owner_email: string | null; orders: number; delivered: number; landings: number; last_order_at: string | null };
type UserRow = { id: string; email: string; created_at: string; last_sign_in_at: string | null; store: string | null; is_admin: boolean };
type OrderRow = { id: string; order_number: number; created_at: string; status: OrderStatus; total: number; district_name: string; store_name: string };
type Errors = {
  marketing: { created_at: string; store_name: string; event_name: string; event_id: string; attempts: number; last_error: string | null }[];
  integrations: { created_at: string; store_name: string | null; provider: string; operation: string; status_code: number | null; message: string | null }[];
  webhooks: { created_at: string; store_name: string | null; provider: string; external_event_id: string; signature_valid: boolean; error: string | null }[];
};

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

export default async function AdminPage({ searchParams }: PageProps<"/admin">) {
  const sp = await searchParams;
  const tab: Tab = typeof sp.tab === "string" && sp.tab in TABS ? (sp.tab as Tab) : "tiendas";
  await requireUser();
  const supabase = await createClient();
  const { data: isAdmin } = await supabase.rpc("is_platform_admin");

  if (!isAdmin) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <ShieldAlert className="size-10 text-muted-foreground" />
        <h1 className="text-xl font-semibold">Acceso solo para administradores de Vendia</h1>
        <Link href="/dashboard" className="text-sm underline">
          Volver a mi panel
        </Link>
      </main>
    );
  }

  const { data: overview } = await supabase.rpc("admin_overview");
  const o = (overview ?? {}) as Record<string, number>;

  let body: React.ReactNode = null;
  if (tab === "tiendas") {
    const { data } = await supabase.rpc("admin_list_stores");
    const stores = (data ?? []) as StoreRow[];
    body = (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Tienda</TableHead>
            <TableHead>Dueño</TableHead>
            <TableHead className="text-right">Landings</TableHead>
            <TableHead className="text-right">Pedidos</TableHead>
            <TableHead className="text-right">Entregados</TableHead>
            <TableHead>Último pedido</TableHead>
            <TableHead>Estado</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {stores.map((s) => (
            <TableRow key={s.id}>
              <TableCell>
                <div className="flex flex-col">
                  <span className="font-medium">{s.name}</span>
                  <span className="text-xs text-muted-foreground">/p/{s.slug} · desde {formatDateTime(s.created_at)}</span>
                </div>
              </TableCell>
              <TableCell className="text-sm">{s.owner_email}</TableCell>
              <TableCell className="text-right">{s.landings}</TableCell>
              <TableCell className="text-right">{s.orders}</TableCell>
              <TableCell className="text-right">{s.delivered}</TableCell>
              <TableCell className="text-muted-foreground">{formatDateTime(s.last_order_at)}</TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  <SimpleBadge tone={s.status === "active" ? "success" : "danger"}>{s.status === "active" ? "Activa" : "Bloqueada"}</SimpleBadge>
                  <StoreStatusButton storeId={s.id} status={s.status} name={s.name} />
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  }
  if (tab === "usuarios") {
    const { data } = await supabase.rpc("admin_list_users");
    body = (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Correo</TableHead>
            <TableHead>Tienda</TableHead>
            <TableHead>Registro</TableHead>
            <TableHead>Último ingreso</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {((data ?? []) as UserRow[]).map((u) => (
            <TableRow key={u.id}>
              <TableCell>
                <span className="flex items-center gap-2">
                  {u.email} {u.is_admin ? <SimpleBadge tone="info">Admin</SimpleBadge> : null}
                </span>
              </TableCell>
              <TableCell>{u.store ?? "—"}</TableCell>
              <TableCell className="text-muted-foreground">{formatDateTime(u.created_at)}</TableCell>
              <TableCell className="text-muted-foreground">{formatDateTime(u.last_sign_in_at)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  }
  if (tab === "pedidos") {
    const { data } = await supabase.rpc("admin_recent_orders", { p_limit: 100 });
    body = (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Pedido</TableHead>
            <TableHead>Tienda</TableHead>
            <TableHead>Distrito</TableHead>
            <TableHead className="text-right">Total</TableHead>
            <TableHead>Estado</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {((data ?? []) as OrderRow[]).map((r) => (
            <TableRow key={r.id}>
              <TableCell>
                #{r.order_number} <span className="text-xs text-muted-foreground">{formatDateTime(r.created_at)}</span>
              </TableCell>
              <TableCell>{r.store_name}</TableCell>
              <TableCell>{r.district_name}</TableCell>
              <TableCell className="text-right">{formatMoney(r.total)}</TableCell>
              <TableCell>
                <OrderStatusBadge status={r.status} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  }
  if (tab === "errores") {
    const { data } = await supabase.rpc("admin_recent_errors");
    const e = (data ?? { marketing: [], integrations: [], webhooks: [] }) as Errors;
    const section = (title: string, rows: { key: string; when: string; store: string | null; text: string }[]) => (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {title} <span className="text-muted-foreground">({rows.length})</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {rows.length ? (
            <ul className="flex flex-col divide-y text-sm">
              {rows.map((r) => (
                <li key={r.key} className="flex flex-col py-2">
                  <span className="text-xs text-muted-foreground">
                    {formatDateTime(r.when)} · {r.store ?? "—"}
                  </span>
                  <span className="break-words">{r.text}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">Sin errores.</p>
          )}
        </CardContent>
      </Card>
    );
    body = (
      <div className="flex flex-col gap-4 p-4">
        {section(
          "Meta Conversions API",
          e.marketing.map((m, i) => ({ key: `m${i}`, when: m.created_at, store: m.store_name, text: `${m.event_name} (${m.attempts} intentos): ${m.last_error ?? ""}` })),
        )}
        {section(
          "Integraciones",
          e.integrations.map((m, i) => ({ key: `i${i}`, when: m.created_at, store: m.store_name, text: `${m.provider} · ${m.operation} · ${m.status_code ?? ""} ${m.message ?? ""}` })),
        )}
        {section(
          "Webhooks",
          e.webhooks.map((m, i) => ({ key: `w${i}`, when: m.created_at, store: m.store_name, text: `${m.provider} · ${m.external_event_id} · ${m.signature_valid ? "" : "firma inválida · "}${m.error ?? ""}` })),
        )}
      </div>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Administración de Vendia</h1>
          <p className="text-sm text-muted-foreground">Vista global de la plataforma.</p>
        </div>
        <Link href="/dashboard" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> Mi panel
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Usuarios" value={formatNumber(o.users)} />
        <Stat label="Tiendas" value={`${formatNumber(o.stores)}${o.stores_blocked ? ` (${o.stores_blocked} bloq.)` : ""}`} />
        <Stat label="Landings publicadas" value={formatNumber(o.landings_published)} />
        <Stat label="Pedidos (30 días)" value={`${formatNumber(o.orders_30d)} / ${formatNumber(o.orders)}`} />
        <Stat label="Revenue entregado" value={formatMoney(o.revenue)} />
        <Stat label="Entregados" value={formatNumber(o.delivered)} />
        <Stat label="Eventos Meta fallidos" value={formatNumber(o.meta_events_failed)} />
        <Stat label="Errores integraciones (7 d)" value={formatNumber(o.integration_errors_7d)} />
      </div>
      <div className="flex gap-1.5">
        {(Object.keys(TABS) as Tab[]).map((t) => (
          <Link
            key={t}
            href={`/admin?tab=${t}`}
            className={cn("rounded-full border px-3 py-1 text-sm", tab === t ? "border-foreground bg-foreground text-background" : "hover:bg-muted")}
          >
            {TABS[t]}
          </Link>
        ))}
      </div>
      <div className="overflow-x-auto rounded-xl border">{body}</div>
    </main>
  );
}
