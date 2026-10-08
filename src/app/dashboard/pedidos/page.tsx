import { AlertTriangle, ShoppingBag } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, PageHeader } from "@/components/dashboard/page-header";
import { OrderStatusBadge } from "@/components/dashboard/status-badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireStore } from "@/lib/auth";
import { displayPeruPhone, formatDateTime, formatMoney } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { ORDER_STATUS_LABELS, ORDER_STATUSES, type OrderStatus } from "@/modules/orders/state-machine";

export const metadata: Metadata = { title: "Pedidos" };

const PAGE_SIZE = 50;

export default async function OrdersPage({ searchParams }: PageProps<"/dashboard/pedidos">) {
  const sp = await searchParams;
  const status = typeof sp.estado === "string" && (ORDER_STATUSES as readonly string[]).includes(sp.estado) ? (sp.estado as OrderStatus) : null;
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 60) : "";
  const page = Math.max(1, Number(sp.pagina) || 1);

  const { store } = await requireStore();
  const supabase = await createClient();

  let query = supabase
    .from("orders")
    .select(
      "id, order_number, created_at, status, customer_name, customer_phone, total, district_name, province_name, is_possible_duplicate, order_items (product_name, offer_name, quantity), order_attribution (utm_source, utm_campaign)",
      { count: "exact" },
    )
    .eq("store_id", store.id)
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  if (status) query = query.eq("status", status);
  if (q) {
    const digits = q.replace(/\D/g, "");
    const safe = q.replace(/[%,()]/g, " ");
    const filters = [`customer_name.ilike.%${safe}%`];
    if (digits.length >= 3) filters.push(`customer_phone.ilike.%${digits}%`);
    if (/^\d{1,9}$/.test(q)) filters.push(`order_number.eq.${q}`);
    query = query.or(filters.join(","));
  }

  const [{ data: orders, count }, { data: statusRows }] = await Promise.all([
    query,
    supabase.from("orders").select("status").eq("store_id", store.id),
  ]);

  const statusCounts = new Map<string, number>();
  for (const row of statusRows ?? []) statusCounts.set(row.status, (statusCounts.get(row.status) ?? 0) + 1);
  const total = statusRows?.length ?? 0;
  const totalPages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));

  const href = (params: Record<string, string | number | null>) => {
    const next = new URLSearchParams();
    const merged = { estado: status, q: q || null, ...params };
    for (const [k, v] of Object.entries(merged)) if (v !== null && v !== "") next.set(k, String(v));
    const s = next.toString();
    return `/dashboard/pedidos${s ? `?${s}` : ""}`;
  };

  return (
    <div>
      <PageHeader title="Pedidos" description="Un pedido no es una venta: avanza cada pedido hasta Entregado para medir tus ventas reales." />

      <div className="mb-4 flex flex-col gap-3">
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
          <Link
            href={href({ estado: null, pagina: null })}
            className={cn("rounded-full border px-3 py-1 text-sm whitespace-nowrap", !status ? "border-foreground bg-foreground text-background" : "hover:bg-muted")}
          >
            Todos <span className="opacity-60">{total}</span>
          </Link>
          {ORDER_STATUSES.map((s) => (
            <Link
              key={s}
              href={href({ estado: s, pagina: null })}
              className={cn("rounded-full border px-3 py-1 text-sm whitespace-nowrap", status === s ? "border-foreground bg-foreground text-background" : "hover:bg-muted")}
            >
              {ORDER_STATUS_LABELS[s]} <span className="opacity-60">{statusCounts.get(s) ?? 0}</span>
            </Link>
          ))}
        </div>
        <form className="max-w-sm">
          {status ? <input type="hidden" name="estado" value={status} /> : null}
          <Input name="q" defaultValue={q} placeholder="Buscar por nombre, celular o número de pedido" />
        </form>
      </div>

      {!orders?.length ? (
        <EmptyState
          icon={ShoppingBag}
          title={total ? "No hay pedidos con este filtro" : "Aún no tienes pedidos"}
          description={total ? "Prueba con otro estado o búsqueda." : "Publica una landing y comparte su link en tus anuncios. Los pedidos aparecerán aquí."}
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
                  <TableHead className="hidden md:table-cell">Distrito</TableHead>
                  <TableHead className="hidden xl:table-cell">Fuente</TableHead>
                  <TableHead>Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((o) => {
                  const item = (o.order_items as { product_name: string; offer_name: string | null; quantity: number }[])[0];
                  const attr = o.order_attribution as unknown as { utm_source: string | null; utm_campaign: string | null } | null;
                  return (
                    <TableRow key={o.id}>
                      <TableCell>
                        <Link href={`/dashboard/pedidos/${o.id}`} className="flex flex-col font-medium hover:underline">
                          <span className="flex items-center gap-1">
                            #{o.order_number}
                            {o.is_possible_duplicate ? <AlertTriangle className="size-3.5 text-amber-500" aria-label="Posible duplicado" /> : null}
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
                        <div className="flex flex-col">
                          <span>{o.district_name}</span>
                          <span className="text-xs text-muted-foreground">{o.province_name}</span>
                        </div>
                      </TableCell>
                      <TableCell className="hidden xl:table-cell">
                        <div className="flex max-w-40 flex-col">
                          <span className="truncate">{attr?.utm_source ?? "Directo"}</span>
                          {attr?.utm_campaign ? <span className="truncate text-xs text-muted-foreground">{attr.utm_campaign}</span> : null}
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
