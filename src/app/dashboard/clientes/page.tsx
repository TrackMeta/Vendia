import { Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, PageHeader } from "@/components/dashboard/page-header";
import { SimpleBadge } from "@/components/dashboard/status-badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireStore } from "@/lib/auth";
import { displayPeruPhone, formatDateTime, formatMoney } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Clientes" };

export default async function CustomersPage({ searchParams }: PageProps<"/dashboard/clientes">) {
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 60) : "";
  const { store } = await requireStore();
  const supabase = await createClient();

  let query = supabase
    .from("customer_stats")
    .select("*")
    .eq("store_id", store.id)
    .order("last_order_at", { ascending: false, nullsFirst: false })
    .limit(200);
  if (q) {
    const safe = q.replace(/[%,()]/g, " ");
    const digits = q.replace(/\D/g, "");
    const filters = [`first_name.ilike.%${safe}%`, `last_name.ilike.%${safe}%`];
    if (digits.length >= 3) filters.push(`phone.ilike.%${digits}%`);
    query = query.or(filters.join(","));
  }
  const { data: customers } = await query;

  return (
    <div>
      <PageHeader title="Clientes" description="Historial de cada cliente: pedidos, entregas, cancelaciones y lo que te ha comprado." />
      <form className="mb-4 max-w-sm">
        <Input name="q" defaultValue={q} placeholder="Buscar por nombre o celular" />
      </form>
      {!customers?.length ? (
        <EmptyState icon={Users} title={q ? "Sin resultados" : "Aún no tienes clientes"} description="Los clientes se crean automáticamente con cada pedido." />
      ) : (
        <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cliente</TableHead>
                <TableHead className="hidden md:table-cell">Ubicación</TableHead>
                <TableHead className="text-right">Pedidos</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Entregados</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Cancel./No entreg.</TableHead>
                <TableHead className="text-right">Ingreso</TableHead>
                <TableHead className="hidden lg:table-cell">Último pedido</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {customers.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <Link href={`/dashboard/clientes/${c.id}`} className="flex flex-col hover:underline">
                      <span className="flex items-center gap-2 font-medium">
                        {c.first_name} {c.last_name ?? ""}
                        {c.delivered_count >= 2 ? <SimpleBadge tone="success">Recurrente</SimpleBadge> : null}
                      </span>
                      <span className="text-xs text-muted-foreground">{displayPeruPhone(c.phone)}</span>
                    </Link>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <div className="flex flex-col">
                      <span>{c.district_name ?? "—"}</span>
                      <span className="text-xs text-muted-foreground">{c.province_name}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right">{c.orders_count}</TableCell>
                  <TableCell className="hidden text-right sm:table-cell">{c.delivered_count}</TableCell>
                  <TableCell className="hidden text-right sm:table-cell">{c.cancelled_count + c.failed_count}</TableCell>
                  <TableCell className="text-right">{formatMoney(c.revenue)}</TableCell>
                  <TableCell className="hidden text-muted-foreground lg:table-cell">{formatDateTime(c.last_order_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
