import { AlertTriangle, ArrowLeft, MapPin, Phone } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ContactPanel } from "@/components/dashboard/contact-panel";
import { LiveRefresh } from "@/components/dashboard/notifications";
import { OrderStatusBadge, SimpleBadge } from "@/components/dashboard/status-badge";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireStore } from "@/lib/auth";
import { cn } from "@/lib/utils";
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
import { mapsLink } from "@/modules/orders/location";
import { type PaymentKind, type PaymentMethod, RECEIPTS_BUCKET } from "@/modules/orders/payments";
import { ORDER_STATUS_LABELS, type OrderStatus } from "@/modules/orders/state-machine";
import { isRealSale, parseSaleMode } from "@/modules/metrics/real-sale";
import { ZoneBadge } from "../../logistica/zone-badge";
import { type AdsEventRow, AdsEventsCard } from "./ads-events-card";
import { AssignSelect } from "./assign-select";
import { OrderDetailsForm } from "./details-form";
import { type PaymentRow, PaymentsCard } from "./payments-card";
import { ShippingCard } from "./shipping-card";
import { StatusActions } from "./status-actions";
import { VariantsEditor } from "./variants-editor";
import { BrandIcon, SourceIcon } from "@/components/brand-icons";

export const metadata: Metadata = { title: "Pedido" };

/** Fila etiqueta → valor (va dentro de un <dl>). El valor se alinea a la derecha con cifras tabulares. */
function Row({ label, strong, children }: { label: string; strong?: boolean; children: React.ReactNode }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-4 py-1.5 text-sm", strong && "text-base font-semibold")}>
      <dt className={cn("shrink-0", !strong && "text-muted-foreground")}>{label}</dt>
      <dd className={cn("min-w-0 text-right tabular-nums [overflow-wrap:anywhere]", strong ? "font-semibold" : "font-medium")}>{children}</dd>
    </div>
  );
}

export default async function OrderDetailPage({ params }: PageProps<"/dashboard/pedidos/[id]">) {
  const { id } = await params;
  const { user, store } = await requireStore();
  const supabase = await createClient();

  // Todo en una sola tanda (antes el pedido esperaba a lo demás)
  const [{ data: attempts }, { data: settings }, { data: team }, { data: paymentRows }, { data: storeCouriers }, { data: order }] = await Promise.all([
    supabase.from("order_contact_attempts").select("id, attempt_number, channel, result, note, next_contact_at, created_by, created_at").eq("order_id", id).order("id", { ascending: false }),
    supabase.from("store_settings").select("contact_sequence, real_sale_mode").eq("store_id", store.id).maybeSingle(),
    supabase.rpc("get_store_team", { p_store_id: store.id }),
    supabase
      .from("order_payments")
      .select("id, kind, amount, method, paid_on, note, receipt_path, verified_at, verified_by, created_by")
      .eq("order_id", id)
      .eq("store_id", store.id)
      .order("created_at"),
    supabase.from("store_couriers").select("courier_id, zone, enabled").eq("store_id", store.id),
    supabase
      .from("orders")
      .select(
        "*, order_items (*), order_attribution (*), order_status_history (id, from_status, to_status, source, note, created_at), landing_pages (title, slug)",
      )
      .eq("id", id)
      .eq("store_id", store.id)
      .maybeSingle(),
  ]);
  const members = ((team ?? []) as { user_id: string; email: string; full_name: string | null }[]).map((m) => ({ id: m.user_id, name: m.full_name || m.email }));
  const memberName = (uid: string | null) => (uid ? (uid === user.id ? "Tú" : (members.find((m) => m.id === uid)?.name ?? "Equipo")) : "Sistema");
  const sequence = ((settings?.contact_sequence as ContactChannel[] | null) ?? DEFAULT_SEQUENCE).filter((x) => x === "call" || x === "whatsapp");

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
  const item = items[0];
  // Comprobantes: enlaces firmados de 1 hora (el bucket es privado)
  const receiptPaths = (paymentRows ?? []).map((p) => p.receipt_path).filter((x): x is string => Boolean(x));
  // Medida y peso por defecto: oferta → producto (order_items no tiene FK a products)
  const isOwner = store.role === "owner";
  const [{ data: metaEntities }, { data: packageProduct }, { data: packageOffer }, { data: productVariants }, { data: signed }, { data: adsEvents }, { data: tiktokSettings }] = await Promise.all([
    metaIds.length
      ? supabase.from("meta_entities").select("id, level, name, status, thumbnail_url, body, title, preview_url").eq("store_id", store.id).in("id", metaIds)
      : Promise.resolve({
          data: [] as { id: string; level: string; name: string | null; status: string | null; thumbnail_url: string | null; body: string | null; title: string | null; preview_url: string | null }[],
        }),
    item?.product_id
      ? supabase.from("products").select("package_size, package_weight, variant_label").eq("id", item.product_id).maybeSingle()
      : Promise.resolve({ data: null }),
    item?.offer_id
      ? supabase.from("product_offers").select("package_size, package_weight").eq("id", item.offer_id).maybeSingle()
      : Promise.resolve({ data: null }),
    item?.product_id
      ? supabase.from("product_variants").select("id, name, stock").eq("product_id", item.product_id).eq("is_active", true).order("position")
      : Promise.resolve({ data: [] as { id: string; name: string; stock: number | null }[] }),
    receiptPaths.length
      ? supabase.storage.from(RECEIPTS_BUCKET).createSignedUrls(receiptPaths, 3600)
      : Promise.resolve({ data: [] as { path: string | null; signedUrl: string }[] }),
    // Anuncios: lo que Meta/TikTok recibieron de este pedido (solo el dueño los ve)
    isOwner
      ? supabase.from("marketing_events").select("platform, event_name, status, last_error, sent_at, created_at").eq("order_id", id).in("event_name", ["Lead", "Purchase", "SubmitForm", "CompletePayment"])
      : Promise.resolve({ data: [] as AdsEventRow[] }),
    isOwner ? supabase.from("store_tiktok_settings").select("enabled").eq("store_id", store.id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const isSale = isRealSale(order as Parameters<typeof isRealSale>[0], parseSaleMode(settings?.real_sale_mode));
  const ad = metaEntities?.find((e) => e.level === "ad");
  const adCampaign = metaEntities?.find((e) => e.level === "campaign");
  const adSet = metaEntities?.find((e) => e.level === "adset");
  const firstName = String(order.customer_name).split(" ")[0];
  const pendingContact = order.status === "new" || order.status === "pending_confirmation";
  const zone = order.zone as "lima" | "provincia";
  const locationHint = order.district_name === order.province_name ? order.province_name : `${order.province_name} ${order.district_name}`;
  const mainItem = items.find((i) => i.kind === "main") ?? item;
  const hasVariants = (productVariants ?? []).length > 0 || (mainItem?.variant_breakdown ?? []).length > 0;
  const variantsEditable = ["new", "pending_confirmation", "confirmed", "preparing"].includes(order.status);

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

  const waHref = `https://wa.me/${order.customer_phone}?text=${waText}`;
  const mapHref = mapsLink(order.delivery_location as string | null);

  return (
    <div className="flex flex-col gap-6">
      <LiveRefresh />
      {/* Barra fija: estado y acciones siempre a mano al bajar (en celular va debajo del header de 56px) */}
      <div className="sticky top-14 z-10 -mx-4 -mt-6 border-b bg-background/95 px-4 py-2 backdrop-blur md:top-0 md:-mx-8 md:-mt-8 md:px-8 md:py-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <Link
              href="/dashboard/pedidos"
              aria-label="Volver a pedidos"
              className="-ml-1.5 inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <ArrowLeft className="size-4" />
            </Link>
            <h1 className="shrink-0 text-base font-semibold tracking-tight tabular-nums md:text-lg">
              <span className="max-sm:sr-only">Pedido </span>#{order.order_number}
            </h1>
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              <OrderStatusBadge status={order.status as OrderStatus} />
              <ZoneBadge zone={zone} />
              <time dateTime={order.created_at} className="hidden text-xs whitespace-nowrap text-muted-foreground tabular-nums sm:inline">
                {formatDateTime(order.created_at)}
              </time>
            </div>
          </div>
          {/* Contacto: arriba a la derecha en celular, al final de la fila en pantallas grandes */}
          <div className="flex shrink-0 items-center gap-2 xl:order-last">
            <a
              href={`tel:+${order.customer_phone}`}
              aria-label="Llamar al cliente"
              className="inline-flex size-8 items-center justify-center rounded-lg border bg-background text-foreground transition-colors hover:bg-muted md:hidden dark:bg-input/30"
            >
              <Phone className="size-4" />
            </a>
            <a
              href={waHref}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Confirmar por WhatsApp"
              className="inline-flex h-8 min-w-8 items-center justify-center gap-1.5 rounded-lg bg-[#25D366] px-1.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 sm:px-3"
            >
              <BrandIcon name="whatsapp" className="size-5" />
              <span className="hidden sm:inline">WhatsApp</span>
            </a>
          </div>
          <StatusActions orderId={order.id} status={order.status as OrderStatus} zone={zone} className="basis-full xl:basis-auto" />
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted-foreground">
          <time dateTime={order.created_at} className="tabular-nums sm:hidden">
            {formatDateTime(order.created_at)}
          </time>
          {order.source === "manual" ? <SimpleBadge>Manual{order.source_channel ? ` · ${order.source_channel}` : ""}</SimpleBadge> : null}
          <div className="ml-auto">
            <AssignSelect orderId={order.id} assignedTo={order.assigned_to} members={members} currentUserId={user.id} />
          </div>
        </div>
        {risks.length ? (
          <p className="flex items-center gap-2 rounded-md bg-red-50 p-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
            <AlertTriangle className="size-4 shrink-0" /> Cliente riesgoso: {risks.map((r) => RISK_LABELS[r] ?? r).join(", ")}. Revisa su historial antes de despachar.
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
            <AlertTriangle className="size-4 shrink-0" /> Posible duplicado: el mismo celular pidió este producto hace menos de 30 minutos.
          </p>
        ) : null}
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

      {/* Escritorio: dos columnas. Celular: una sola (las columnas usan `contents` y el orden lo da `order-*`):
          cliente → productos → envío → pagos → dirección → origen, contacto e historial */}
      <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="contents lg:flex lg:flex-col lg:gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Cliente y entrega</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex min-w-0 flex-col">
                <Link href={`/dashboard/clientes/${order.customer_id}`} className="w-fit font-medium hover:underline">
                  {order.customer_name}
                </Link>
                <span className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
                  <span className="tabular-nums">{displayPeruPhone(order.customer_phone)}</span>
                  {order.dni ? <span className="tabular-nums"> · DNI {order.dni}</span> : null}
                  {order.customer_email ? ` · ${order.customer_email}` : ""}
                </span>
              </div>
              <div className="rounded-lg bg-muted/50 p-3 text-sm">
                <p className="font-medium">{order.address}</p>
                {order.reference ? <p className="text-muted-foreground">Ref: {order.reference}</p> : null}
                <p className="mt-1">
                  {order.district_name}, {order.province_name}, {order.department_name}{" "}
                  <span className="text-xs text-muted-foreground tabular-nums">(ubigeo {order.district_code})</span>
                </p>
                {order.customer_notes ? <p className="mt-2 text-muted-foreground">Nota del cliente: {order.customer_notes}</p> : null}
                {mapHref ? (
                  <a
                    href={mapHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                  >
                    <MapPin className="size-4" /> Ver ubicación en el mapa
                  </a>
                ) : null}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Productos y montos</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <ul className="divide-y">
                {items.map((i) => (
                  <li key={i.id} className="flex items-start justify-between gap-4 py-2 text-sm first:pt-0">
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span className="font-medium">{i.product_name}</span>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {i.offer_name ? `${i.offer_name} · ` : ""}
                        {i.quantity} u.
                      </span>
                      {i.kind === "bump" ? (
                        <span className="mt-0.5">
                          <SimpleBadge tone="info">Adicional del formulario</SimpleBadge>
                        </span>
                      ) : null}
                      {i.kind === "upsell" ? (
                        <span className="mt-0.5">
                          <SimpleBadge tone="success">Agregado en gracias</SimpleBadge>
                        </span>
                      ) : null}
                    </div>
                    <span className="shrink-0 text-right font-medium whitespace-nowrap tabular-nums">{formatMoney(i.line_price)}</span>
                  </li>
                ))}
              </ul>
              {hasVariants && mainItem ? (
                <VariantsEditor
                  orderId={order.id}
                  label={packageProduct?.variant_label ?? "Variante"}
                  units={mainItem.quantity}
                  current={mainItem.variant_breakdown ?? []}
                  options={productVariants ?? []}
                  editable={variantsEditable}
                />
              ) : null}
              <dl className="border-t pt-1.5">
                <Row label="Subtotal">{formatMoney(order.subtotal)}</Row>
                <Row label="Envío cobrado">{formatMoney(order.shipping_charged)}</Row>
                <Row label="Total" strong>
                  {formatMoney(order.total)}
                </Row>
                {Number(order.advance_amount) > 0 ? (
                  <>
                    <Row label="Adelanto">{formatMoney(order.advance_amount)}</Row>
                    <Row label="Saldo a cobrar" strong>
                      {formatMoney(order.balance_due)}
                    </Row>
                  </>
                ) : null}
              </dl>
              <dl className="rounded-lg bg-muted/50 px-3 py-1.5">
                <Row label="Costo de producto">{formatMoney(order.product_cost_total)}</Row>
                {Number(order.packaging_cost) > 0 ? <Row label="Embalaje">{formatMoney(order.packaging_cost)}</Row> : null}
                {Number(order.commission_amount) > 0 ? <Row label="Comisión del confirmador">{formatMoney(order.commission_amount)}</Row> : null}
              </dl>
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
              delivery_location: (order.delivery_location as string | null) ?? null,
              exported_at: order.exported_at,
            }}
          />

          <div className="order-1 lg:order-none">
            <OrderDetailsForm
              orderId={order.id}
              initial={{
                internal_notes: order.internal_notes ?? "",
                address: order.address,
                reference: order.reference ?? "",
              }}
            />
          </div>
        </div>

        <div className="contents lg:flex lg:flex-col lg:gap-6">
          <PaymentsCard
            storeId={store.id}
            orderId={order.id}
            zone={zone}
            total={Number(order.total)}
            advanceExpected={Number(order.advance_amount)}
            payments={payments}
          />

          <div className="order-2 flex flex-col gap-6 lg:order-none">
            {ad ? (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <BrandIcon name="meta" /> Anuncio
                  </CardTitle>
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

            {isOwner ? (
              <AdsEventsCard
                orderId={order.id}
                rows={(adsEvents ?? []) as AdsEventRow[]}
                fromLanding={order.source === "landing"}
                isSale={isSale}
                tiktok={Boolean(tiktokSettings?.enabled)}
              />
            ) : null}

            <Card>
              <CardHeader>
                <CardTitle>Origen del pedido</CardTitle>
              </CardHeader>
              <CardContent>
                <dl>
                  <Row label="Landing">{landing ? landing.title : "—"}</Row>
                  <Row label="Fuente">
                    <span className="inline-flex items-center gap-1.5">
                      <SourceIcon source={attr?.utm_source} />
                      {attr?.utm_source ?? "Directo / orgánico"}
                    </span>
                  </Row>
                  <Row label="Medio">{attr?.utm_medium ?? "—"}</Row>
                  <Row label="Campaña">{attr?.utm_campaign ?? "—"}</Row>
                  <Row label="Anuncio">{ad?.name ?? attr?.utm_content ?? "—"}</Row>
                  <Row label="Conjunto">{adSet?.name ?? attr?.utm_term ?? "—"}</Row>
                  <Row label="ID campaña">{attr?.campaign_id ?? "—"}</Row>
                  <Row label="ID anuncio">{attr?.ad_id ?? "—"}</Row>
                  <Row label="Clic de Meta (fbclid)">{attr?.fbclid ? "Sí" : "No"}</Row>
                </dl>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Intentos de contacto</CardTitle>
                {attempts?.length ? (
                  <CardAction>
                    <SimpleBadge>{attempts.length}</SimpleBadge>
                  </CardAction>
                ) : null}
              </CardHeader>
              <CardContent>
                {attempts?.length ? (
                  <ol className="flex flex-col gap-3">
                    {attempts.map((a) => (
                      <li key={a.id} className="flex flex-col border-l-2 pl-3 text-sm">
                        <span className="font-medium">
                          {a.channel === "call" ? (
                            <Phone className="mr-1 inline size-3.5 align-[-2px]" />
                          ) : (
                            <BrandIcon name="whatsapp" className="mr-1 inline size-4 align-[-3px]" />
                          )}
                          {a.channel === "call" ? "Llamada" : "WhatsApp"} {a.attempt_number} · {CONTACT_RESULTS[a.result as ContactResult]?.label ?? a.result}
                        </span>
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {formatDateTime(a.created_at)} · {memberName(a.created_by)}
                        </span>
                        {a.next_contact_at ? (
                          <span className="text-xs text-sky-600 tabular-nums dark:text-sky-400">Volver a llamar: {formatDateTime(a.next_contact_at)}</span>
                        ) : null}
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
                      <span className="text-xs text-muted-foreground tabular-nums">
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
    </div>
  );
}
