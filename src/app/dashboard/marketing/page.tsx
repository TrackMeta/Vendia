import type { Metadata } from "next";
import { PageHeader } from "@/components/dashboard/page-header";
import { SimpleBadge } from "@/components/dashboard/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireOwner } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { parseSaleMode, REAL_SALE_MODES } from "@/modules/metrics/real-sale";
import { MetaConnect } from "./meta-connect";
import { TikTokSettingsForm } from "./tiktok-form";
import { MetaSettingsForm, RetryButton, TestEventButton, UrlTemplate } from "./meta-forms";

export const metadata: Metadata = { title: "Marketing" };

const STATUS_TONE = { sent: "success", pending: "info", failed: "danger", skipped: "neutral" } as const;
const STATUS_LABEL = { sent: "Enviado", pending: "Pendiente", failed: "Falló", skipped: "Omitido" } as const;

export default async function MarketingPage() {
  const { store } = await requireOwner();
  const supabase = await createClient();
  const [{ data: settings }, { data: tokenConfigured }, { data: events }, { data: storeSettings }, { data: tiktok }, { data: tiktokToken }] = await Promise.all([
    supabase
      .from("store_meta_settings")
      .select(
        "pixel_id, test_event_code, enabled, send_lead, send_purchase, ad_account_id, ad_account_name, ad_account_currency, meta_user_name, last_sync_at, last_sync_error",
      )
      .eq("store_id", store.id)
      .maybeSingle(),
    supabase.rpc("meta_token_configured", { p_store_id: store.id }),
    supabase
      .from("marketing_events")
      .select("id, event_name, event_id, status, attempts, last_error, created_at, sent_at, orders (order_number)")
      .eq("store_id", store.id)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase.from("store_settings").select("real_sale_mode").eq("store_id", store.id).single(),
    supabase.from("store_tiktok_settings").select("pixel_code, test_event_code, enabled, send_lead, send_purchase").eq("store_id", store.id).maybeSingle(),
    supabase.rpc("tiktok_token_configured", { p_store_id: store.id }),
  ]);

  const triggerLabel = REAL_SALE_MODES[parseSaleMode(storeSettings?.real_sale_mode)];
  const failed = (events ?? []).filter((e) => e.status === "failed").length;

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader title="Marketing" description="Meta Pixel + Conversions API, con deduplicación y Purchase solo cuando hay venta real." />

      <MetaConnect
        storeName={store.name}
        connection={{
          connected: Boolean(settings?.ad_account_id),
          accountName: settings?.ad_account_name ?? null,
          accountId: settings?.ad_account_id ?? null,
          currency: settings?.ad_account_currency ?? null,
          userName: settings?.meta_user_name ?? null,
          pixelId: settings?.pixel_id ?? null,
          lastSyncAt: settings?.last_sync_at ?? null,
          lastSyncError: settings?.last_sync_error ?? null,
        }}
      />

      <Card>
        <CardHeader>
          <CardTitle>Cómo mide Vendia tus conversiones</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
          <div className="rounded-lg bg-muted/50 p-3">
            <p className="font-medium">Navegador (Pixel)</p>
            <p className="text-muted-foreground">PageView · ViewContent · InitiateCheckout (abre el formulario) · Lead (envía el pedido)</p>
          </div>
          <div className="rounded-lg bg-muted/50 p-3">
            <p className="font-medium">Servidor (Conversions API)</p>
            <p className="text-muted-foreground">
              Lead (mismo event_id que el Pixel → Meta lo deduplica) · <b>Purchase cuando hay venta real ({triggerLabel})</b>, con el valor real cobrado.
            </p>
          </div>
          <p className="text-xs text-muted-foreground sm:col-span-2">
            Consejo: al inicio optimiza tus campañas por <b>Lead</b> (más volumen) y mide la rentabilidad con <b>Purchase</b>. Cambia el estado de venta real en
            Configuración.
          </p>
        </CardContent>
      </Card>

      <details className="group rounded-xl bg-card p-4 ring-1 ring-foreground/10 [&_[data-slot=card]]:border-0 [&_[data-slot=card]]:shadow-none">
        <summary className="cursor-pointer text-sm font-medium">Configuración manual del Pixel y Conversions API (avanzado)</summary>
        <p className="mt-1 text-xs text-muted-foreground">Solo si no usas «Conectar Meta». Aquí también activas o pausas el envío de Lead y Purchase.</p>
        <MetaSettingsForm
          initial={{
            pixel_id: settings?.pixel_id ?? "",
            test_event_code: settings?.test_event_code ?? "",
            enabled: settings?.enabled ?? false,
            send_lead: settings?.send_lead ?? true,
            send_purchase: settings?.send_purchase ?? true,
          }}
          tokenConfigured={Boolean(tokenConfigured)}
        />
      </details>

      <Card>
        <CardHeader>
          <CardTitle>Plantilla de URL para tus anuncios</CardTitle>
          <CardDescription>Pégala en Meta Ads → Anuncio → Parámetros de URL. Así cada pedido queda atado a su campaña, conjunto y anuncio.</CardDescription>
        </CardHeader>
        <CardContent>
          <UrlTemplate />
        </CardContent>
      </Card>

      <TikTokSettingsForm
        tokenConfigured={Boolean(tiktokToken)}
        initial={{
          pixel_code: tiktok?.pixel_code ?? "",
          test_event_code: tiktok?.test_event_code ?? "",
          enabled: tiktok?.enabled ?? false,
          send_lead: tiktok?.send_lead ?? true,
          send_purchase: tiktok?.send_purchase ?? true,
        }}
      />

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle>Eventos enviados (Meta y TikTok)</CardTitle>
            <CardDescription>Últimos 50 eventos de servidor (Conversions API de Meta y Events API de TikTok).</CardDescription>
          </div>
          <div className="flex gap-2">
            <TestEventButton />
            {failed ? <RetryButton count={failed} /> : null}
          </div>
        </CardHeader>
        <CardContent>
          {!events?.length ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Aún no hay eventos. Se registran cuando llegan pedidos con Meta activado.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Evento</TableHead>
                  <TableHead>Pedido</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="hidden md:table-cell">Fecha</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.map((e) => {
                  const order = e.orders as unknown as { order_number: number } | { order_number: number }[] | null;
                  const number = Array.isArray(order) ? order[0]?.order_number : order?.order_number;
                  return (
                    <TableRow key={e.id}>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-medium">{e.event_name}</span>
                          <span className="font-mono text-[11px] text-muted-foreground">{e.event_id.slice(0, 24)}…</span>
                        </div>
                      </TableCell>
                      <TableCell>{number ? `#${number}` : "—"}</TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-0.5">
                          <SimpleBadge tone={STATUS_TONE[e.status as keyof typeof STATUS_TONE]}>
                            {STATUS_LABEL[e.status as keyof typeof STATUS_LABEL]}
                          </SimpleBadge>
                          {e.last_error ? <span className="max-w-64 truncate text-xs text-destructive">{e.last_error}</span> : null}
                        </div>
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground md:table-cell">{formatDateTime(e.sent_at ?? e.created_at)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
