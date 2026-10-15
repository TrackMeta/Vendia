import type { Metadata } from "next";
import { Help } from "@/components/dashboard/metric";
import { requireOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { parseSaleMode, REAL_SALE_MODES } from "@/modules/metrics/real-sale";
import { parseSyncInterval } from "@/modules/meta/schedule";
import { EventsSignal, type EventsStatus, UrlTemplateDetails } from "./events-signal";
import { MetaConnect } from "./meta-connect";
import { MetaSettingsForm, URL_TEMPLATE } from "./meta-forms";
import { TikTokSettingsForm } from "./tiktok-form";

export const metadata: Metadata = { title: "Marketing" };


export default async function MarketingPage() {
  const { store } = await requireOwner();
  const supabase = await createClient();
  const [{ data: settings }, { data: tokenConfigured }, { data: events }, { data: storeSettings }, { data: tiktok }, { data: tiktokToken }, { data: metaAccounts }, { data: syncRow }] = await Promise.all([
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
      .select("platform, status, attempts, sent_at")
      .eq("store_id", store.id)
      .order("created_at", { ascending: false })
      .limit(300),
    supabase.from("store_settings").select("real_sale_mode").eq("store_id", store.id).single(),
    supabase.from("store_tiktok_settings").select("pixel_code, test_event_code, enabled, send_lead, send_purchase").eq("store_id", store.id).maybeSingle(),
    supabase.rpc("tiktok_token_configured", { p_store_id: store.id }),
    // Si aún no se corrió el SQL de «varias cuentas», esto viene vacío y se usa la cuenta principal
    supabase.from("store_meta_accounts").select("ad_account_id, name, currency, last_sync_at, last_sync_error").eq("store_id", store.id).order("added_at"),
    // Aparte: si aún no se corrió el SQL del reloj, esta columna no existe y no debe romper lo demás
    supabase.from("store_meta_settings").select("sync_every_minutes").eq("store_id", store.id).maybeSingle(),
  ]);
  const connectedAccounts = metaAccounts?.length
    ? metaAccounts.map((a) => ({ id: a.ad_account_id, name: a.name, currency: a.currency, lastSyncAt: a.last_sync_at, lastSyncError: a.last_sync_error }))
    : settings?.ad_account_id
      ? [
          {
            id: settings.ad_account_id,
            name: settings.ad_account_name,
            currency: settings.ad_account_currency,
            lastSyncAt: settings.last_sync_at,
            lastSyncError: settings.last_sync_error,
          },
        ]
      : [];

  const triggerLabel = REAL_SALE_MODES[parseSaleMode(storeSettings?.real_sale_mode)];
  // Señal por plataforma: último evento enviado y cuántos fallaron (y aún se pueden reintentar)
  const statusFor = (platform: "meta" | "tiktok"): EventsStatus => {
    const mine = (events ?? []).filter((e) => (e.platform ?? "meta") === platform);
    return {
      lastSentAt: mine.find((e) => e.status === "sent" && e.sent_at)?.sent_at ?? null,
      failed: mine.filter((e) => e.status === "failed" && e.attempts < 5).length,
    };
  };

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          Marketing
          <Help label="la medición de conversiones">
            <span className="flex flex-col gap-2">
              <span>
                <b>En la landing (Pixel):</b> PageView, ViewContent, InitiateCheckout (abre el formulario) y Lead (envía el pedido).
              </span>
              <span>
                <b>Desde el servidor:</b> Lead con el mismo id que el Pixel (Meta y TikTok no lo cuentan doble) y <b>Purchase solo cuando hay venta real</b> (
                {triggerLabel}), con el valor cobrado.
              </span>
              <span className="text-muted-foreground">
                Consejo: al inicio optimiza por Lead (más volumen) y mide la rentabilidad con Purchase. El momento de venta real se cambia en Configuración.
              </span>
            </span>
          </Help>
        </h1>
        <p className="text-sm text-muted-foreground">Conecta Meta y TikTok: Vendia lee tu gasto y les avisa tus ventas reales.</p>
      </div>

      <MetaConnect
        storeName={store.name}
        connection={{
          connected: Boolean(settings?.ad_account_id),
          accountId: settings?.ad_account_id ?? null,
          accounts: connectedAccounts,
          syncEvery: parseSyncInterval(syncRow?.sync_every_minutes),
          userName: settings?.meta_user_name ?? null,
          pixelId: settings?.pixel_id ?? null,
          lastSyncAt: settings?.last_sync_at ?? null,
          lastSyncError: settings?.last_sync_error ?? null,
        }}
        signal={settings?.pixel_id ? <EventsSignal status={statusFor("meta")} enabled={Boolean(settings?.enabled)} /> : null}
        extras={
          <>
            <UrlTemplateDetails template={URL_TEMPLATE} where="Meta Ads → Anuncio → Parámetros de URL" />
            <details className="group rounded-lg border">
              <summary className="cursor-pointer list-none px-3 py-2.5 text-sm font-medium marker:hidden">
                <span className="mr-1 inline-block transition-transform group-open:rotate-90">›</span> Configuración manual del Pixel y Conversions API (avanzado)
              </summary>
              <div className="border-t px-3 py-3">
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
              </div>
            </details>
          </>
        }
      />

      <TikTokSettingsForm
        tokenConfigured={Boolean(tiktokToken)}
        initial={{
          pixel_code: tiktok?.pixel_code ?? "",
          test_event_code: tiktok?.test_event_code ?? "",
          enabled: tiktok?.enabled ?? false,
          send_lead: tiktok?.send_lead ?? true,
          send_purchase: tiktok?.send_purchase ?? true,
        }}
        signal={tiktok?.pixel_code ? <EventsSignal status={statusFor("tiktok")} enabled={Boolean(tiktok?.enabled)} /> : null}
      />
    </div>
  );
}
