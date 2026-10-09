import { ArrowLeft, MessageCircle } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { OrderStatusBadge } from "@/components/dashboard/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireStore } from "@/lib/auth";
import { displayPeruPhone, formatDateTime, formatMoney } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import type { OrderStatus } from "@/modules/orders/state-machine";

export const metadata: Metadata = { title: "Cliente" };

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-muted/50 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
    </div>
  );
}

export default async function CustomerPage({ params }: PageProps<"/dashboard/clientes/[id]">) {
  const { id } = await params;
  const { store } = await requireStore();
  const supabase = await createClient();

  const [{ data: customer }, { data: orders }] = await Promise.all([
    supabase.from("customer_stats").select("*").eq("id", id).eq("store_id", store.id).maybeSingle(),
    supabase
      .from("orders")
      .select("id, order_number, created_at, status, total, order_items (product_name, offer_name)")
      .eq("customer_id", id)
      .eq("store_id", store.id)
      .order("created_at", { ascending: false }),
  ]);
  if (!customer) notFound();

  return (
    <div className="flex flex-col gap-6">
      <Link href="/dashboard/clientes" className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Clientes
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {customer.first_name} {customer.last_name ?? ""}
          </h1>
          <p className="text-sm text-muted-foreground">
            {displayPeruPhone(customer.phone)}
            {customer.dni ? ` · DNI ${customer.dni}` : ""} · cliente desde {formatDateTime(customer.created_at)}
          </p>
        </div>
        <a
          href={`https://wa.me/${customer.whatsapp?.replace(/\D/g, "") || customer.phone}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 rounded-lg bg-[#25D366] px-3 py-2 text-sm font-semibold text-white"
        >
          <MessageCircle className="size-4" /> WhatsApp
        </a>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="Pedidos" value={customer.orders_count} />
        <Stat label="Entregados" value={customer.delivered_count} />
        <Stat label="Cancelados" value={customer.cancelled_count} />
        <Stat label="No entregados" value={customer.failed_count} />
        <Stat label="Ingreso" value={formatMoney(customer.revenue)} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Última dirección</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          <p className="font-medium">{customer.address ?? "—"}</p>
          {customer.reference ? <p className="text-muted-foreground">Ref: {customer.reference}</p> : null}
          <p>
            {customer.district_name}, {customer.province_name}, {customer.department_name}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pedidos</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Pedido</TableHead>
                <TableHead>Producto</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Estado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(orders ?? []).map((o) => {
                const item = (o.order_items as { product_name: string; offer_name: string | null }[])[0];
                return (
                  <TableRow key={o.id}>
                    <TableCell>
                      <Link href={`/dashboard/pedidos/${o.id}`} className="flex flex-col font-medium hover:underline">
                        #{o.order_number}
                        <span className="text-xs font-normal text-muted-foreground">{formatDateTime(o.created_at)}</span>
                      </Link>
                    </TableCell>
                    <TableCell>
                      {item?.product_name}
                      {item?.offer_name ? <span className="text-muted-foreground"> · {item.offer_name}</span> : null}
                    </TableCell>
                    <TableCell className="text-right">{formatMoney(o.total)}</TableCell>
                    <TableCell>
                      <OrderStatusBadge status={o.status as OrderStatus} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
