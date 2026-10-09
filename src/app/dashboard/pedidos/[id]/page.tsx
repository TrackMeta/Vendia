import { AlertTriangle, ArrowLeft, MessageCircle, Phone } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ContactPanel } from "@/components/dashboard/contact-panel";
import { LiveRefresh } from "@/components/dashboard/notifications";
import { OrderStatusBadge, SimpleBadge } from "@/components/dashboard/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireStore } from "@/lib/auth";
import { displayPeruPhone, formatDateTime, formatMoney, one } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import {
  CANCEL_REASONS,
  type CancelReason,
  CONTACT_RESULTS,
  type ContactChannel,
  type ContactResult,
  DEFAULT_SEQUENCE,
  FAILURE_REASONS,
  type FailureReason,
  RISK_LABELS,
} from "@/modules/orders/contact";
import { itemLabel, type VariantBreakdown } from "@/modules/orders/items";
import { type PaymentKind, type PaymentMethod, RECEIPTS_BUCKET } from "@/modules/orders/payments";
import { ORDER_STATUS_LABELS, type OrderStatus } from "@/modules/orders/state-machine";
import { ZoneBadge } from "../../logistica/logistics-table";
import { AssignSelect } from "./assign-select";
import { OrderDetailsForm } from "./details-form";
import { type PaymentRow, PaymentsCard } from "./payments-card";
import { ShippingCard } from "./shipping-card";
import { StatusActions } from "./status-actions";
import { VariantsEditor } from "./variants-editor";

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
  const { user, store } = await requireStore();
  const supabase = await createClient();

  const [{ data: attempts }, { data: settings }, { data: team }, { data: paymentRows }, { data: storeCouriers }] = await Promise.all([
    supabase.from("order_contact_attempts").select("id, attempt_number, channel, result, note, next_contact_at, created_by, created_at").eq("order_id", id).order("id", { ascending: false }),
    supabase.from("store_settings").select("contact_sequence").eq("store_id", store.id).maybeSingle(),
    supabase.rpc("get_store_team", { p_store_id: store.id }),
    supabase
      .from("order_payments")
      .select("id, kind, amount, method, paid_on, note, receipt_path, verified_at, verified_by, created_by")
      .eq("order_id", id)
      .eq("store_id", store.id)
      .order("created_at"),
    supabase.from("store_couriers").select("courier_id, zone, enabled").eq("store_id", store.id),
  ]);
  const members = ((team ?? []) as { user_id: string; email: string; full_name: string | null }[]).map((m) => ({ id: m.user_id, name: m.full_name || m.email }));
  const memberName = (uid: string | null) => (uid ? (uid === user.id ? "Tú" : (members.find((m) => m.id === uid)?.name ?? "Equipo")) : "Sistema");
  const sequence = ((settings?.contact_sequence as ContactChannel[] | null) ?? DEFAULT_SEQUENCE).filter((x) => x === "call" || x === "whatsapp");

  const { data: order } = await supabase
    .from("orders")
    .select(
      "*, order_items (*), order_attribution (*), order_status_history (id, from_status, to_status, source, note, created_at), landing_pages (title, slug)",
    )
    .eq("id", id)
    .eq("store_id", store.id)
    .maybeSingle();
  if (!order) notFound();

  const items = order.order_items as {
    id: string;
    product_name: string;
    offer_name: string | null;
    quantity: number;
    line_price: number;
    unit_cost: number;
    product_id: string | null;
    offer_id: string | null;
    kind: "main" | "bump" | "upsell";
    variant_breakdown: VariantBreakdown;
  }[];
  const attr = one(order.order_attribution as Record<string, string | null>[]);
  const history = [...(order.order_status_history as { id: number; from_status: string | null; to_status: string; source: string; note: string | null; created_at: string }[])].sort(
    (a, b) => b.id - a.id,
  );
  const landing = one(order.landing_pages as { title: string; slug: string }[]);

  // Tarjeta del anuncio que trajo el pedido (si Meta está conectado y el pedido trae su ad_id)
  const metaIds = [attr?.ad_id, attr?.adset_id, attr?.campaign_id].filter((x): x is string => Boolean(x && /^\d{5,30}$/.test(x)));
  const { data: metaEntities } = metaIds.length
    ? await supabase.from("meta_entities").select("id, level, name, status, thumbnail_url, body, title, preview_url").eq("store_id", store.id).in("id", metaIds)
    : { data: [] as { id: string; level: string; name: string | null; status: string | null; thumbnail_url: string | null; body: string | null; title: string | null; preview_url: string | null }[] };
  const ad = metaEntities?.find((e) => e.level === "ad");
  const adCampaign = metaEntities?.find((e) => e.level === "campaign");
  const adSet = metaEntities?.find((e) => e.level === "adset");
  const firstName = String(order.customer_name).split(" ")[0];
  const item = items[0];
  const pendingContact = order.status === "new" || order.status === "pending_confirmation";
  const zone = order.zone as "lima" | "provincia";
  const locationHint = order.district_name === order.province_name ? order.province_name : `${order.province_name} ${order.district_name}`;
  // Medida y peso por defecto: oferta → producto (order_items no tiene FK a products)
  const [{ data: packageProduct }, { data: packageOffer }, { data: productVariants }] = await Promise.all([
    item?.product_id
      ? supabase.from("products").select("package_size, package_weight, variant_label").eq("id", item.product_id).maybeSingle()
      : Promise.resolve({ data: null }),
    item?.offer_id
      ? supabase.from("product_offers").select("package_size, package_weight").eq("id", item.offer_id).maybeSingle()
      : Promise.resolve({ data: null }),
    item?.product_id
      ? supabase.from("product_variants").select("id, name, stock").eq("product_id", item.product_id).eq("is_active", true).order("position")
      : Promise.resolve({ data: [] as { id: string; name: string; stock: number | null }[] }),
  ]);
  const mainItem = items.find((i) => i.kind === "main") ?? item;
  const hasVariants = (productVariants ?? []).length > 0 || (mainItem?.variant_breakdown ?? []).length > 0;
  const variantsEditable = ["new", "pending_confirmation", "confirmed", "preparing"].includes(order.status);

  // Comprobantes: enlaces firmados de 1 hora (el bucket es privado)
  const receiptPaths = (paymentRows ?? []).map((p) => p.receipt_path).filter((x): x is string => Boolean(x));
  const { data: signed } = receiptPaths.length
    ? await supabase.storage.from(RECEIPTS_BUCKET).createSignedUrls(receiptPaths, 3600)
    : { data: [] as { path: string | null; signedUrl: string }[] };
  const signedUrl = (path: string | null) => (path ? (signed?.find((s) => s.path === path)?.signedUrl ?? null) : null);
  const payments: PaymentRow[] = (paymentRows ?? []).map((p) => ({
    id: p.id,
    kind: p.kind as PaymentKind,
    amount: Number(p.amount),
    method: p.method as PaymentMethod,
    paid_on: p.paid_on,
    note: p.note,
    receipt_url: signedUrl(p.receipt_path),
    receipt_is_pdf: Boolean(p.receipt_path?.endsWith(".pdf")),
    verified: Boolean(p.verified_at),
    verified_by_name: p.verified_by ? memberName(p.verified_by) : null,
    created_by_name: memberName(p.created_by),
  }));
  const risks = ((order.risk_reasons as string[] | null) ?? []).filter((r) => r !== "posible_duplicado");
  const waText = encodeURIComponent(
    `Hola ${firstName}, te saludamos de ${store.name}. Recibimos tu pedido #${order.order_number} de ${item ? itemLabel(item) : ""} por ${formatMoney(order.total)}, con entrega en ${order.address}, ${order.district_name}. ¿Nos confirmas tu pedido?`,
  );

  return (
    <div className="flex flex-col gap-6">
      <LiveRefresh />
      {/* Celular: llamar y WhatsApp siempre a mano, sobre la barra de navegación */}
      <div className="fixed inset-x-0 bottom-[calc(3.6rem+env(safe-area-inset-bottom))] z-20 flex gap-2 border-t bg-background/95 p-2 backdrop-blur md:hidden">
        <a href={`tel:+${order.customer_phone}`} className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-foreground py-3 text-sm font-semibold text-background">
          <Phone className="size-4" /> Llamar
        </a>
        <a
          href={`https://wa.me/${order.customer_phone}?text=${waText}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-[#25D366] py-3 text-sm font-semibold text-white"
        >
          <MessageCircle className="size-4" /> WhatsApp
        </a>
      </div>
      <div className="flex flex-col gap-3">
        <Link href="/dashboard/pedidos" className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> Pedidos
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Pedido #{order.order_number}</h1>
          <OrderStatusBadge status={order.status as OrderStatus} className="text-sm" />
          <ZoneBadge zone={zone} />
          {order.source === "manual" ? <SimpleBadge>Manual{order.source_channel ? ` · ${order.source_channel}` : ""}</SimpleBadge> : null}
          <span className="text-sm text-muted-foreground">{formatDateTime(order.created_at)}</span>
          <div className="ml-auto">
            <AssignSelect orderId={order.id} assignedTo={order.assigned_to} members={members} currentUserId={user.id} />
          </div>
        </div>
        {risks.length ? (
          <p className="flex items-center gap-2 rounded-md bg-red-50 p-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
            <AlertTriangle className="size-4" /> Cliente riesgoso: {risks.map((r) => RISK_LABELS[r] ?? r).join(", ")}. Revisa su historial antes de despachar.
          </p>
        ) : null}
        {order.cancel_reason ? (
          <p className="text-sm text-muted-foreground">Motivo de cancelación: <b>{CANCEL_REASONS[order.cancel_reason as CancelReason] ?? order.cancel_reason}</b></p>
        ) : null}
        {order.failure_reason ? (
          <p className="text-sm text-muted-foreground">Motivo de no entrega: <b>{FAILURE_REASONS[order.failure_reason as FailureReason] ?? order.failure_reason}</b></p>
        ) : null}
        {order.is_possible_duplicate ? (
          <p className="flex items-center gap-2 rounded-md bg-amber-50 p-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200">
            <AlertTriangle className="size-4" /> Posible duplicado: el mismo celular pidió este producto hace menos de 30 minutos.
          </p>
        ) : null}
        <StatusActions orderId={order.id} status={order.status as OrderStatus} zone={zone} />
        {pendingContact ? (
          <ContactPanel
            storeName={store.name}
            sequence={sequence}
            order={{
              id: order.id,
              order_number: order.order_number,
              customer_name: order.customer_name,
              customer_phone: order.customer_phone,
              total: Number(order.total),
              address: order.address,
              district_name: order.district_name,
              product_label: item ? itemLabel(item) : "",
              contact_attempts: order.contact_attempts,
              last_contact_result: order.last_contact_result,
              next_contact_at: order.next_contact_at,
              contact_sequence_done: order.contact_sequence_done,
              zone,
              dni: order.dni,
              agency_destination: order.agency_destination,
              location_hint: locationHint,
            }}
          />
        ) : null}
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
                    {order.customer_email ? ` · ${order.customer_email}` : ""}
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
                    {i.kind === "bump" ? <SimpleBadge tone="info">Adicional del formulario</SimpleBadge> : null}
                    {i.kind === "upsell" ? <SimpleBadge tone="success">Agregado en gracias</SimpleBadge> : null}
                    {i.offer_name ? <span className="text-muted-foreground"> · {i.offer_name}</span> : null}
                    <span className="text-muted-foreground"> · {i.quantity} u.</span>
                  </span>
                  <span className="shrink-0 whitespace-nowrap tabular-nums">{formatMoney(i.line_price)}</span>
                </div>
              ))}
              {hasVariants && mainItem ? (
                <div className="mt-2">
                  <VariantsEditor
                    orderId={order.id}
                    label={packageProduct?.variant_label ?? "Variante"}
                    units={mainItem.quantity}
                    current={mainItem.variant_breakdown ?? []}
                    options={productVariants ?? []}
                    editable={variantsEditable}
                  />
                </div>
              ) : null}
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
                {Number(order.packaging_cost) > 0 ? <Row label="Embalaje">{formatMoney(order.packaging_cost)}</Row> : null}
                {Number(order.commission_amount) > 0 ? <Row label="Comisión del confirmador">{formatMoney(order.commission_amount)}</Row> : null}
              </div>
            </CardContent>
          </Card>

          <ShippingCard
            orderId={order.id}
            locationHint={locationHint}
            defaultSize={packageOffer?.package_size ?? packageProduct?.package_size ?? "PAQUETE S"}
            defaultWeight={Number(packageOffer?.package_weight ?? packageProduct?.package_weight ?? 1)}
            storeCouriers={storeCouriers ?? []}
            initial={{
              zone,
              status: order.status,
              courier_id: order.courier_id,
              tracking_code: order.tracking_code,
              courier_order_number: order.courier_order_number,
              agency_destination: order.agency_destination,
              agency_origin: order.agency_origin,
              pickup_key: order.pickup_key,
              package_size: order.package_size,
              package_weight: order.package_weight === null ? null : Number(order.package_weight),
              shipping_cost: Number(order.shipping_cost),
              return_shipments: order.return_shipments,
              dni: order.dni,
              exported_at: order.exported_at,
            }}
          />

          <PaymentsCard
            storeId={store.id}
            orderId={order.id}
            zone={zone}
            total={Number(order.total)}
            advanceExpected={Number(order.advance_amount)}
            payments={payments}
          />

          <OrderDetailsForm
            orderId={order.id}
            initial={{
              internal_notes: order.internal_notes ?? "",
              address: order.address,
              reference: order.reference ?? "",
            }}
          />
        </div>

        <div className="flex flex-col gap-6">
          {ad ? (
            <Card>
              <CardHeader>
                <CardTitle>Anuncio</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <div className="flex gap-3">
                  {ad.thumbnail_url ? (
                    // Miniatura servida por Meta (dominio externo variable)
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={ad.thumbnail_url} alt="" className="size-20 shrink-0 rounded-lg object-cover" />
                  ) : null}
                  <div className="flex min-w-0 flex-col gap-0.5 text-sm">
                    <span className="font-medium">{ad.name}</span>
                    {adCampaign?.name ? <span className="truncate text-xs text-muted-foreground">Campaña: {adCampaign.name}</span> : null}
                    {adSet?.name ? <span className="truncate text-xs text-muted-foreground">Conjunto: {adSet.name}</span> : null}
                    {ad.status ? <span className="text-xs text-muted-foreground">{ad.status.toLowerCase().replace(/_/g, " ")}</span> : null}
                  </div>
                </div>
                {ad.title || ad.body ? (
                  <p className="line-clamp-4 text-sm text-muted-foreground">
                    {ad.title ? <b className="text-foreground">{ad.title}. </b> : null}
                    {ad.body}
                  </p>
                ) : null}
                {ad.preview_url ? (
                  <a href={ad.preview_url} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-primary hover:underline">
                    Ver anuncio
                  </a>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Origen del pedido</CardTitle>
            </CardHeader>
            <CardContent>
              <Row label="Landing">{landing ? landing.title : "—"}</Row>
              <Row label="Fuente">{attr?.utm_source ?? "Directo / orgánico"}</Row>
              <Row label="Medio">{attr?.utm_medium ?? "—"}</Row>
              <Row label="Campaña">{attr?.utm_campaign ?? "—"}</Row>
              <Row label="Anuncio">{ad?.name ?? attr?.utm_content ?? "—"}</Row>
              <Row label="Conjunto">{adSet?.name ?? attr?.utm_term ?? "—"}</Row>
              <Row label="ID campaña">{attr?.campaign_id ?? "—"}</Row>
              <Row label="ID anuncio">{attr?.ad_id ?? "—"}</Row>
              <Row label="Clic de Meta (fbclid)">{attr?.fbclid ? "Sí" : "No"}</Row>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Intentos de contacto</CardTitle>
            </CardHeader>
            <CardContent>
              {attempts?.length ? (
                <ol className="flex flex-col gap-3">
                  {attempts.map((a) => (
                    <li key={a.id} className="flex flex-col border-l-2 pl-3 text-sm">
                      <span className="font-medium">
                        {a.channel === "call" ? "📞 Llamada" : "💬 WhatsApp"} {a.attempt_number} · {CONTACT_RESULTS[a.result as ContactResult]?.label ?? a.result}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatDateTime(a.created_at)} · {memberName(a.created_by)}
                      </span>
                      {a.next_contact_at ? <span className="text-xs text-sky-600">Volver a llamar: {formatDateTime(a.next_contact_at)}</span> : null}
                      {a.note ? <span className="mt-0.5 text-xs">{a.note}</span> : null}
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-sm text-muted-foreground">Aún no se ha contactado al cliente.</p>
              )}
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
      <div className="h-16 md:hidden" aria-hidden />
    </div>
  );
}
