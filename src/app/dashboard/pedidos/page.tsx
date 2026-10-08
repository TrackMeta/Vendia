import { AlertTriangle, CalendarClock, Plus, ShoppingBag, UserCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { LiveRefresh } from "@/components/dashboard/notifications";
import { EmptyState, PageHeader } from "@/components/dashboard/page-header";
import { OrderStatusBadge, SimpleBadge } from "@/components/dashboard/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireStore } from "@/lib/auth";
import { displayPeruPhone, formatDateTime, formatMoney, one } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { CONTACT_RESULTS, type ContactResult, RISK_LABELS } from "@/modules/orders/contact";
import { ORDER_STATUS_LABELS, ORDER_STATUSES, type OrderStatus } from "@/modules/orders/state-machine";
import { ZoneBadge } from "../logistica/logistics-table";

export const metadata: Metadata = { title: "Pedidos" };

const PAGE_SIZE = 50;

export default async function OrdersPage({ searchParams }: PageProps<"/dashboard/pedidos">) {
  const sp = await searchParams;
  const status = typeof sp.estado === "string" && (ORDER_STATUSES as readonly string[]).includes(sp.estado) ? (sp.estado as OrderStatus) : null;
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 60) : "";
  const zone = sp.zona === "lima" || sp.zona === "provincia" ? sp.zona : null;
  const mine = sp.mios === "1";
  const sort = sp.orden === "zona" ? "zona" : "fecha";
  const page = Math.max(1, Number(sp.pagina) || 1);

  const { user, store } = await requireStore();
  const supabase = await createClient();

  let query = supabase
    .from("orders")
    .select(
      "id, order_number, created_at, status, zone, source, source_channel, customer_name, customer_phone, total, district_name, province_name, is_possible_duplicate, risk_reasons, assigned_to, contact_attempts, last_contact_result, next_contact_at, contact_sequence_done, order_items (product_name, offer_name, quantity), order_attribution (utm_source, utm_campaign)",
      { count: "exact" },
    )
    .eq("store_id", store.id);
  query = sort === "zona" ? query.order("zone", { ascending: true }).order("created_at", { ascending: false }) : query.order("created_at", { ascending: false });
  query = query.range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  if (status) query = query.eq("status", status);
  if (zone) query = query.eq("zone", zone);
  if (mine) query = query.eq("assigned_to", user.id);
  if (q) {
    const digits = q.replace(/\D/g, "");
    const safe = q.replace(/[%,()]/g, " ");
    const filters = [`customer_name.ilike.%${safe}%`];
    if (digits.length >= 3) filters.push(`customer_phone.ilike.%${digits}%`);
    if (/^\d{1,9}$/.test(q)) filters.push(`order_number.eq.${q}`);
    query = query.or(filters.join(","));
  }

  let countsQuery = supabase.from("orders").select("status, zone").eq("store_id", store.id);
  if (zone) countsQuery = countsQuery.eq("zone", zone);
  if (mine) countsQuery = countsQuery.eq("assigned_to", user.id);

  const [{ data: orders, count }, { data: statusRows }, { data: team }] = await Promise.all([
    query,
    countsQuery,
    supabase.rpc("get_store_team", { p_store_id: store.id }),
  ]);

  const statusCounts = new Map<string, number>();
  for (const row of statusRows ?? []) statusCounts.set(row.status, (statusCounts.get(row.status) ?? 0) + 1);
  const total = statusRows?.length ?? 0;
  const totalPages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));
  const members = new Map(((team ?? []) as { user_id: string; email: string; full_name: string | null }[]).map((m) => [m.user_id, m.full_name || m.email]));

  const href = (params: Record<string, string | number | null>) => {
    const next = new URLSearchParams();
    const merged: Record<string, string | number | null> = {
      estado: status,
      q: q || null,
      zona: zone,
      mios: mine ? "1" : null,
      orden: sort === "zona" ? "zona" : null,
      ...params,
    };
    for (const [k, v] of Object.entries(merged)) if (v !== null && v !== "") next.set(k, String(v));
    const s = next.toString();
    return `/dashboard/pedidos${s ? `?${s}` : ""}`;
  };
  const chip = (active: boolean) => cn("rounded-full border px-3 py-1 text-sm whitespace-nowrap", active ? "border-foreground bg-foreground text-background" : "hover:bg-muted");
  const small = (active: boolean) => cn("rounded-md border px-2.5 py-0.5 text-sm", active ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted");

  return (
    <div>
      <LiveRefresh />
      <PageHeader
        title="Pedidos"
        description="Un pedido no es una venta: avanza cada pedido hasta Entregado para medir tus ventas reales."
        actions={
          <Link href="/dashboard/pedidos/nuevo" className={buttonVariants()}>
            <Plus /> Nuevo pedido
          </Link>
        }
      />
      {sp.sinpermiso ? (
        <p className="mb-4 rounded-md bg-amber-50 p-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
          Esa sección es solo para el dueño de la tienda.
        </p>
      ) : null}

      <div className="mb-4 flex flex-col gap-3">
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
          <Link href={href({ estado: null, pagina: null })} className={chip(!status)}>
            Todos <span className="opacity-60">{total}</span>
          </Link>
          {ORDER_STATUSES.map((s) => (
            <Link key={s} href={href({ estado: s, pagina: null })} className={chip(status === s)}>
              {ORDER_STATUS_LABELS[s]} <span className="opacity-60">{statusCounts.get(s) ?? 0}</span>
            </Link>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Link href={href({ zona: null, pagina: null })} className={small(!zone)}>
            Lima y provincia
          </Link>
          <Link href={href({ zona: "lima", pagina: null })} className={small(zone === "lima")}>
            Lima
          </Link>
          <Link href={href({ zona: "provincia", pagina: null })} className={small(zone === "provincia")}>
            Provincia
          </Link>
          <span className="mx-1 text-muted-foreground">·</span>
          <Link href={href({ mios: mine ? null : "1", pagina: null })} className={small(mine)}>
            Mis pendientes
          </Link>
          <span className="mx-1 text-muted-foreground">·</span>
          <Link href={href({ orden: sort === "zona" ? null : "zona", pagina: null })} className={small(sort === "zona")}>
            Ordenar por zona
          </Link>
        </div>
        <form className="max-w-sm">
          {status ? <input type="hidden" name="estado" value={status} /> : null}
          {zone ? <input type="hidden" name="zona" value={zone} /> : null}
          {mine ? <input type="hidden" name="mios" value="1" /> : null}
          <Input name="q" defaultValue={q} placeholder="Buscar por nombre, celular o número de pedido" />
        </form>
      </div>

      {!orders?.length ? (
        <EmptyState
          icon={ShoppingBag}
          title={total ? "No hay pedidos con este filtro" : "Aún no tienes pedidos"}
          description={total ? "Prueba con otro estado, zona o búsqueda." : "Publica una landing y comparte su link en tus anuncios, o registra un pedido a mano."}
        />
      ) : (
        <>
          <div className="rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Pedido</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead className="hidden lg:table-cell">Producto</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="hidden md:table-cell">Ubicación</TableHead>
                  <TableHead className="hidden xl:table-cell">Contacto</TableHead>
                  <TableHead className="hidden xl:table-cell">Fuente</TableHead>
                  <TableHead>Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((o) => {
                  const item = (o.order_items as { product_name: string; offer_name: string | null; quantity: number }[])[0];
                  const attr = one(o.order_attribution as unknown as { utm_source: string | null; utm_campaign: string | null }[]);
                  const risks = ((o.risk_reasons as string[] | null) ?? []).filter((r) => r !== "posible_duplicado");
                  const pendingContact = o.status === "new" || o.status === "pending_confirmation";
                  return (
                    <TableRow key={o.id}>
                      <TableCell>
                        <Link href={`/dashboard/pedidos/${o.id}`} className="flex flex-col font-medium hover:underline">
                          <span className="flex items-center gap-1">
                            #{o.order_number}
                            {o.is_possible_duplicate ? <AlertTriangle className="size-3.5 text-amber-500" aria-label="Posible duplicado" /> : null}
                            {risks.length ? <AlertTriangle className="size-3.5 text-red-500" aria-label={risks.map((r) => RISK_LABELS[r] ?? r).join(", ")} /> : null}
                          </span>
                          <span className="text-xs font-normal text-muted-foreground">{formatDateTime(o.created_at)}</span>
                        </Link>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="max-w-40 truncate">{o.customer_name}</span>
                          <span className="text-xs text-muted-foreground">{displayPeruPhone(o.customer_phone)}</span>
                        </div>
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">
                        <div className="flex max-w-48 flex-col">
                          <span className="truncate">{item?.product_name}</span>
                          <span className="text-xs text-muted-foreground">
                            {item?.offer_name ?? ""} · {item?.quantity} u.
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">{formatMoney(o.total)}</TableCell>
                      <TableCell className="hidden md:table-cell">
                        <div className="flex flex-col items-start gap-0.5">
                          <ZoneBadge zone={o.zone as "lima" | "provincia"} />
                          <span className="text-xs text-muted-foreground">
                            {o.district_name}, {o.province_name}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="hidden xl:table-cell">
                        <div className="flex flex-col text-xs">
                          {pendingContact ? (
                            <>
                              <span>
                                {o.contact_attempts ? `${o.contact_attempts} intento(s)` : "Sin contactar"}
                                {o.contact_sequence_done ? " · secuencia completa" : ""}
                              </span>
                              {o.next_contact_at ? (
                                <span className="flex items-center gap-1 text-sky-600">
                                  <CalendarClock className="size-3" /> {formatDateTime(o.next_contact_at)}
                                </span>
                              ) : o.last_contact_result ? (
                                <span className="text-muted-foreground">{CONTACT_RESULTS[o.last_contact_result as ContactResult]?.label}</span>
                              ) : null}
                            </>
                          ) : (
                            <span className="text-muted-foreground">{o.contact_attempts ? `${o.contact_attempts} intento(s)` : "—"}</span>
                          )}
                          {o.assigned_to ? (
                            <span className="flex items-center gap-1 text-muted-foreground">
                              <UserCheck className="size-3" /> {o.assigned_to === user.id ? "Tú" : (members.get(o.assigned_to) ?? "Equipo")}
                            </span>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="hidden xl:table-cell">
                        <div className="flex max-w-40 flex-col">
                          {o.source === "manual" ? (
                            <SimpleBadge>Manual{o.source_channel ? ` · ${o.source_channel}` : ""}</SimpleBadge>
                          ) : (
                            <>
                              <span className="truncate">{attr?.utm_source ?? "Directo"}</span>
                              {attr?.utm_campaign ? <span className="truncate text-xs text-muted-foreground">{attr.utm_campaign}</span> : null}
                            </>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <OrderStatusBadge status={o.status as OrderStatus} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          {totalPages > 1 ? (
            <div className="mt-4 flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                Página {page} de {totalPages} · {count} pedidos
              </span>
              <div className="flex gap-2">
                {page > 1 ? (
                  <Link href={href({ pagina: page - 1 })} className="rounded-md border px-3 py-1 hover:bg-muted">
                    Anterior
                  </Link>
                ) : null}
                {page < totalPages ? (
                  <Link href={href({ pagina: page + 1 })} className="rounded-md border px-3 py-1 hover:bg-muted">
                    Siguiente
                  </Link>
                ) : null}
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
