import { AlertTriangle, ArrowDownUp, CalendarClock, Plus, Search, ShoppingBag, UserCheck, X } from "lucide-react";
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
import { orderSearchFilters } from "@/modules/orders/search";
import { ZoneBadge } from "../logistica/logistics-table";
import { SourceIcon } from "@/components/brand-icons";
import { OrderCard } from "./orders-card";
import { CountChip, SCROLL_ROW, Segmented, ToggleChip } from "./orders-filters";

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
    // Número, celular, nombre, DNI o ubicación (departamento, provincia, distrito)
    const filters = orderSearchFilters(q);
    if (filters.length) query = query.or(filters.join(","));
  }

  // Contadores calculados en la base (bajar las filas para contarlas falla con más de 1000 pedidos).
  // «Mis pedidos» son pocos: ahí se cuentan directamente.
  const countsPromise = mine
    ? (() => {
        let q = supabase.from("orders").select("status").eq("store_id", store.id).eq("assigned_to", user.id).limit(5000);
        if (zone) q = q.eq("zone", zone);
        return q.then(({ data }) => {
          const m: Record<string, number> = {};
          for (const r of data ?? []) m[r.status] = (m[r.status] ?? 0) + 1;
          return m;
        });
      })()
    : supabase.rpc("order_status_counts", { p_store_id: store.id, p_zone: zone ?? null }).then(({ data }) => (data ?? {}) as Record<string, number>);

  const [{ data: orders, count }, countsByStatus, { data: team }] = await Promise.all([
    query,
    countsPromise,
    supabase.rpc("get_store_team", { p_store_id: store.id }),
  ]);

  const statusCounts = new Map<string, number>(Object.entries(countsByStatus).map(([k, v]) => [k, Number(v)]));
  const total = [...statusCounts.values()].reduce((s, n) => s + n, 0);
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
  const filtered = Boolean(status || zone || mine || q || sort === "zona");

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

      {/* Filtros en una sola barra: estados arriba; zona, míos, orden y búsqueda debajo (al lado en escritorio) */}
      <div className="mb-4 flex flex-col gap-2">
        <nav aria-label="Filtrar por estado" className={SCROLL_ROW}>
          <CountChip href={href({ estado: null, pagina: null })} active={!status} label="Todos" count={total} />
          {ORDER_STATUSES.map((s) => (
            <CountChip key={s} href={href({ estado: s, pagina: null })} active={status === s} label={ORDER_STATUS_LABELS[s]} count={statusCounts.get(s) ?? 0} />
          ))}
        </nav>
        <div className="flex flex-col gap-2 md:flex-row md:items-center">
          <div className="flex flex-wrap items-center gap-1.5">
            <Segmented
              label="Zona"
              options={[
                { key: "todas", label: "Todas", href: href({ zona: null, pagina: null }), active: !zone },
                { key: "lima", label: "Lima", href: href({ zona: "lima", pagina: null }), active: zone === "lima" },
                { key: "provincia", label: "Provincia", href: href({ zona: "provincia", pagina: null }), active: zone === "provincia" },
              ]}
            />
            <ToggleChip href={href({ mios: mine ? null : "1", pagina: null })} active={mine} icon={UserCheck} title="Solo los pedidos asignados a ti">
              Solo míos
            </ToggleChip>
            <ToggleChip href={href({ orden: sort === "zona" ? null : "zona", pagina: null })} active={sort === "zona"} icon={ArrowDownUp} title="Lima primero, luego provincia">
              Ordenar por zona
            </ToggleChip>
            {filtered ? (
              <Link href="/dashboard/pedidos" className="px-1.5 text-sm text-muted-foreground hover:text-foreground hover:underline">
                Limpiar
              </Link>
            ) : null}
          </div>
          <form role="search" className="relative md:ml-auto md:w-80">
            {status ? <input type="hidden" name="estado" value={status} /> : null}
            {zone ? <input type="hidden" name="zona" value={zone} /> : null}
            {mine ? <input type="hidden" name="mios" value="1" /> : null}
            {sort === "zona" ? <input type="hidden" name="orden" value="zona" /> : null}
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              name="q"
              defaultValue={q}
              enterKeyHint="search"
              aria-label="Buscar pedidos"
              placeholder="Nombre, celular, DNI, distrito o n.º"
              title="Buscar por nombre, celular, DNI, distrito o n.º de pedido"
              className={cn("h-9 bg-background pl-8 md:h-8", q && "pr-8")}
            />
            {q ? (
              <Link
                href={href({ q: null, pagina: null })}
                aria-label="Borrar búsqueda"
                className="absolute top-1/2 right-1 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground md:size-6"
              >
                <X className="size-3.5" />
              </Link>
            ) : null}
          </form>
        </div>
      </div>

      {!orders?.length ? (
        <EmptyState
          icon={ShoppingBag}
          title={total ? "No hay pedidos con este filtro" : "Aún no tienes pedidos"}
          description={total ? "Prueba con otro estado, zona o búsqueda." : "Publica una landing y comparte su link en tus anuncios, o registra un pedido a mano."}
          action={
            total ? (
              <Link href="/dashboard/pedidos" className="text-sm font-medium text-primary hover:underline">
                Quitar filtros
              </Link>
            ) : (
              <Link href="/dashboard/pedidos/nuevo" className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/85">
                Crear pedido manual
              </Link>
            )
          }
        />
      ) : (
        <>
          {/* Celular: tarjetas (la tabla se corta en pantallas angostas) */}
          <ul className="flex flex-col gap-2 md:hidden">
            {orders.map((o) => {
              const item = (o.order_items as { product_name: string; offer_name: string | null; quantity: number }[])[0];
              const attr = one(o.order_attribution as unknown as { utm_source: string | null; utm_campaign: string | null }[]);
              const risky = o.is_possible_duplicate || ((o.risk_reasons as string[] | null) ?? []).some((r) => r !== "posible_duplicado");
              return (
                <li key={o.id}>
                  <OrderCard
                    order={{ ...o, status: o.status as OrderStatus, zone: o.zone as "lima" | "provincia" }}
                    risky={risky}
                    manual={o.source === "manual"}
                    source={o.source === "manual" ? o.source_channel : (attr?.utm_source ?? null)}
                    product={item ? `${item.product_name}${item.quantity ? ` (${item.quantity} u.)` : ""}` : ""}
                  />
                </li>
              );
            })}
          </ul>
          <div className="hidden overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10 md:block">
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
                      <TableCell className="text-right font-medium tabular-nums">{formatMoney(o.total)}</TableCell>
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
                            <span className="flex items-center gap-1.5">
                              <SourceIcon source={o.source_channel} />
                              <SimpleBadge>Manual{o.source_channel ? ` · ${o.source_channel}` : ""}</SimpleBadge>
                            </span>
                          ) : (
                            <>
                              <span className="flex items-center gap-1.5 truncate">
                                <SourceIcon source={attr?.utm_source} />
                                {attr?.utm_source ?? "Directo"}
                              </span>
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
