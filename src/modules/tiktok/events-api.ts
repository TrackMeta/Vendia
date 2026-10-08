import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptSecret } from "@/lib/crypto";
import { buildTikTokEvent, paymentEventId, submitEventId, TIKTOK_EVENTS_URL, type TikTokEvent, type TikTokEventName } from "./events";

const MAX_ATTEMPTS = 5;
const MAX_AGE_SECONDS = 7 * 24 * 3600;

type Settings = { pixel_code: string | null; access_token_encrypted: string | null; test_event_code: string | null; enabled: boolean; send_lead: boolean; send_purchase: boolean };

async function getSettings(admin: SupabaseClient, storeId: string): Promise<Settings | null> {
  const { data } = await admin
    .from("store_tiktok_settings")
    .select("pixel_code, access_token_encrypted, test_event_code, enabled, send_lead, send_purchase")
    .eq("store_id", storeId)
    .maybeSingle();
  return (data as Settings | null) ?? null;
}

/**
 * Registra (una sola vez) y envía SubmitForm (pedido) o CompletePayment (venta real) a TikTok.
 * Usa la misma bandeja que Meta (marketing_events, platform = 'tiktok') con reintentos.
 */
export async function enqueueTikTokOrderEvent(admin: SupabaseClient, orderId: string, event: TikTokEventName) {
  const { data: order } = await admin
    .from("orders")
    .select("id, store_id, order_number, created_at, total, customer_phone, customer_id, order_items (product_id, product_name, quantity), order_attribution (ttclid, ttp, client_ip, user_agent, landing_url)")
    .eq("id", orderId)
    .single();
  if (!order) return null;
  const settings = await getSettings(admin, order.store_id);
  if (!settings?.enabled || !settings.pixel_code || !settings.access_token_encrypted) return null;
  if (event === "SubmitForm" && !settings.send_lead) return null;
  if (event === "CompletePayment" && !settings.send_purchase) return null;

  const attr = (Array.isArray(order.order_attribution) ? order.order_attribution[0] : order.order_attribution) as {
    ttclid: string | null;
    ttp: string | null;
    client_ip: string | null;
    user_agent: string | null;
    landing_url: string | null;
  } | null;
  const item = (order.order_items as { product_id: string | null; product_name: string; quantity: number }[])[0];
  const eventId = event === "SubmitForm" ? submitEventId(order.id) : paymentEventId(order.id);
  const payload = buildTikTokEvent({
    event,
    eventId,
    eventTime: event === "SubmitForm" ? new Date(order.created_at) : new Date(),
    phone: order.customer_phone,
    customerId: order.customer_id,
    ttclid: attr?.ttclid,
    ttp: attr?.ttp,
    ip: attr?.client_ip,
    userAgent: attr?.user_agent,
    value: Number(order.total),
    productId: item?.product_id,
    productName: item?.product_name,
    quantity: item?.quantity,
    orderNumber: order.order_number,
    url: attr?.landing_url,
  });

  const { data: inserted } = await admin
    .from("marketing_events")
    .upsert(
      {
        store_id: order.store_id,
        order_id: order.id,
        platform: "tiktok",
        event_name: event,
        event_id: eventId,
        event_time: new Date(payload.event_time * 1000).toISOString(),
        action_source: "website",
        payload,
      },
      { onConflict: "store_id,platform,event_id", ignoreDuplicates: true },
    )
    .select("id");
  const id = inserted?.[0]?.id as string | undefined;
  if (!id) return null;
  await sendTikTokEvent(admin, id);
  return id;
}

/** Envía un evento de la bandeja a TikTok y registra el resultado. */
export async function sendTikTokEvent(admin: SupabaseClient, marketingEventId: string, f: typeof fetch = fetch): Promise<boolean> {
  const { data: row } = await admin.from("marketing_events").select("id, store_id, payload, status, attempts, event_name").eq("id", marketingEventId).single();
  if (!row || row.status === "sent" || row.status === "skipped" || row.attempts >= MAX_ATTEMPTS) return false;
  const settings = await getSettings(admin, row.store_id);

  const fail = async (message: string, response?: unknown, final = false) => {
    await admin
      .from("marketing_events")
      .update({ status: final ? "skipped" : "failed", attempts: row.attempts + 1, last_error: message.slice(0, 1000), response: response ?? null })
      .eq("id", row.id);
    return false;
  };

  if (!settings?.enabled || !settings.pixel_code || !settings.access_token_encrypted) return fail("TikTok no está configurado o está desactivado", undefined, true);
  const payload = row.payload as TikTokEvent;
  if (Date.now() / 1000 - payload.event_time > MAX_AGE_SECONDS) return fail("El evento tiene más de 7 días", undefined, true);
  let token: string;
  try {
    token = decryptSecret(settings.access_token_encrypted);
  } catch {
    return fail("No se pudo descifrar el token de TikTok", undefined, true);
  }

  try {
    const res = await f(TIKTOK_EVENTS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Access-Token": token },
      body: JSON.stringify({
        event_source: "web",
        event_source_id: settings.pixel_code,
        ...(settings.test_event_code ? { test_event_code: settings.test_event_code } : {}),
        data: [payload],
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const json = (await res.json().catch(() => ({}))) as { code?: number; message?: string };
    if (!res.ok || (json.code !== undefined && json.code !== 0)) {
      // 40001/40105 = token inválido o sin permiso: no reintentar solo
      const final = json.code === 40001 || json.code === 40105;
      return fail(json.message ?? `HTTP ${res.status}`, json, final);
    }
    await admin
      .from("marketing_events")
      .update({ status: "sent", attempts: row.attempts + 1, sent_at: new Date().toISOString(), last_error: null, response: json })
      .eq("id", row.id);
    return true;
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Error de red");
  }
}
