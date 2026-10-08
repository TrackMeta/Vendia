import { AlertTriangle, ArrowLeft, MessageCircle } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { OrderStatusBadge } from "@/components/dashboard/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireStore } from "@/lib/auth";
import { displayPeruPhone, formatDateTime, formatMoney, one } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { ORDER_STATUS_LABELS, type OrderStatus } from "@/modules/orders/state-machine";
import { OrderDetailsForm } from "./details-form";
import { StatusActions } from "./status-actions";

export const metadata: Metadata = { title: "Pedido" };

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{children}</span>
    </div>
  );
}

export default async function OrderDetailPage({ params }: PageProps<"/dashboard/pedidos/[id]">) {
  const { id } = await params;
  const { store } = await requireStore();
  const supabase = await createClient();

  const { data: order } = await supabase
    .from("orders")
    .select(
      "*, order_items (*), order_attribution (*), order_status_history (id, from_status, to_status, source, note, created_at), landing_pages (title, slug)",
    )
    .eq("id", id)
    .eq("store_id", store.id)
    .maybeSingle();
  if (!order) notFound();

  const items = order.order_items as { id: string; product_name: string; offer_name: string | null; quantity: number; line_price: number; unit_cost: number }[];
  const attr = one(order.order_attribution as Record<string, string | null>[]);
  const history = [...(order.order_status_history as { id: number; from_status: string | null; to_status: string; source: string; note: string | null; created_at: string }[])].sort(
    (a, b) => b.id - a.id,
  );
  const landing = one(order.landing_pages as { title: string; slug: string }[]);
  const firstName = String(order.customer_name).split(" ")[0];
  const item = items[0];
  const waText = encodeURIComponent(
    `Hola ${firstName}, te saludamos de ${store.name}. Recibimos tu pedido #${order.order_number} de ${item?.product_name ?? ""}${
      item?.offer_name ? ` (${item.offer_name})` : ""
    } por ${formatMoney(order.total)}, con entrega en ${order.address}, ${order.district_name}. ¿Nos confirmas tu pedido?`,
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Link href="/dashboard/pedidos" className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> Pedidos
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Pedido #{order.order_number}</h1>
          <OrderStatusBadge status={order.status as OrderStatus} className="text-sm" />
          <span className="text-sm text-muted-foreground">{formatDateTime(order.created_at)}</span>
        </div>
        {order.is_possible_duplicate ? (
          <p className="flex items-center gap-2 rounded-md bg-amber-50 p-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200">
            <AlertTriangle className="size-4" /> Posible duplicado: el mismo celular pidió este producto hace menos de 30 minutos.
          </p>
        ) : null}
        <StatusActions orderId={order.id} status={order.status as OrderStatus} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Cliente y entrega</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-col">
                  <Link href={`/dashboard/clientes/${order.customer_id}`} className="font-medium hover:underline">
                    {order.customer_name}
                  </Link>
                  <span className="text-sm text-muted-foreground">
                    {displayPeruPhone(order.customer_phone)}
                    {order.dni ? ` · DNI ${order.dni}` : ""}
                  </span>
                </div>
                <a
                  href={`https://wa.me/${order.customer_phone}?text=${waText}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 rounded-lg bg-[#25D366] px-3 py-2 text-sm font-semibold text-white"
                >
                  <MessageCircle className="size-4" /> Confirmar por WhatsApp
                </a>
              </div>
              <div className="rounded-lg bg-muted/50 p-3 text-sm">
                <p className="font-medium">{order.address}</p>
                {order.reference ? <p className="text-muted-foreground">Ref: {order.reference}</p> : null}
                <p className="mt-1">
                  {order.district_name}, {order.province_name}, {order.department_name}{" "}
                  <span className="text-xs text-muted-foreground">(ubigeo {order.district_code})</span>
                </p>
                {order.customer_notes ? <p className="mt-2 text-muted-foreground">Nota del cliente: {order.customer_notes}</p> : null}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Productos y montos</CardTitle>
            </CardHeader>
            <CardContent>
              {items.map((i) => (
                <div key={i.id} className="flex justify-between gap-4 border-b py-2 text-sm last:border-b-0">
                  <span>
                    <span className="font-medium">{i.product_name}</span>
                    {i.offer_name ? <span className="text-muted-foreground"> · {i.offer_name}</span> : null}
                    <span className="text-muted-foreground"> · {i.quantity} u.</span>
                  </span>
                  <span>{formatMoney(i.line_price)}</span>
                </div>
              ))}
              <div className="mt-3 border-t pt-2">
                <Row label="Subtotal">{formatMoney(order.subtotal)}</Row>
                <Row label="Envío cobrado">{formatMoney(order.shipping_charged)}</Row>
                <Row label="Total">{formatMoney(order.total)}</Row>
                {Number(order.advance_amount) > 0 ? (
                  <>
                    <Row label="Adelanto">{formatMoney(order.advance_amount)}</Row>
                    <Row label="Saldo a cobrar">{formatMoney(order.balance_due)}</Row>
                  </>
                ) : null}
                <Row label="Costo de producto">{formatMoney(order.product_cost_total)}</Row>
              </div>
            </CardContent>
          </Card>

          <OrderDetailsForm
            orderId={order.id}
            initial={{
              shipping_cost: Number(order.shipping_cost),
              internal_notes: order.internal_notes ?? "",
              address: order.address,
              reference: order.reference ?? "",
            }}
          />
        </div>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Origen del pedido</CardTitle>
            </CardHeader>
            <CardContent>
              <Row label="Landing">{landing ? landing.title : "—"}</Row>
              <Row label="Fuente">{attr?.utm_source ?? "Directo / orgánico"}</Row>
              <Row label="Medio">{attr?.utm_medium ?? "—"}</Row>
              <Row label="Campaña">{attr?.utm_campaign ?? "—"}</Row>
              <Row label="Anuncio">{attr?.utm_content ?? "—"}</Row>
              <Row label="Conjunto">{attr?.utm_term ?? "—"}</Row>
              <Row label="ID campaña">{attr?.campaign_id ?? "—"}</Row>
              <Row label="ID anuncio">{attr?.ad_id ?? "—"}</Row>
              <Row label="Clic de Meta (fbclid)">{attr?.fbclid ? "Sí" : "No"}</Row>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Historial</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="flex flex-col gap-3">
                {history.map((h) => (
                  <li key={h.id} className="flex flex-col border-l-2 pl-3 text-sm">
                    <span className="font-medium">{ORDER_STATUS_LABELS[h.to_status as OrderStatus]}</span>
                    <span className="text-xs text-muted-foreground">
                      {formatDateTime(h.created_at)} · {h.source === "system" ? "Sistema" : h.source === "integration" ? "Integración" : "Manual"}
                    </span>
                    {h.note ? <span className="mt-0.5 text-xs">{h.note}</span> : null}
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
