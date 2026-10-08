import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptSecret } from "@/lib/crypto";
import { buildServerEvent, isTooOld, leadEventId, META_GRAPH_VERSION, type MetaEventName, purchaseEventId, type ServerEvent } from "./events";
import { isRealSale, parseSaleMode } from "@/modules/metrics/real-sale";
import { buildUserData } from "./user-data";

const MAX_ATTEMPTS = 5;

type MetaSettings = {
  pixel_id: string | null;
  capi_token_encrypted: string | null;
  test_event_code: string | null;
  enabled: boolean;
  send_lead: boolean;
  send_purchase: boolean;
};

async function getSettings(admin: SupabaseClient, storeId: string): Promise<MetaSettings | null> {
  const { data } = await admin
    .from("store_meta_settings")
    .select("pixel_id, capi_token_encrypted, test_event_code, enabled, send_lead, send_purchase")
    .eq("store_id", storeId)
    .maybeSingle();
  return (data as MetaSettings | null) ?? null;
}

/**
 * Registra (una sola vez) y envía el evento Lead o Purchase de un pedido.
 * - Lead: al crear el pedido (event_id = lead_<orderId>, igual que el eventID del Pixel).
 * - Purchase: cuando el pedido llega al estado de venta real (event_id = purchase_<orderId>), solo servidor.
 * Devuelve el id de marketing_events si se registró, o null si no aplica.
 */
export async function enqueueOrderEvent(admin: SupabaseClient, orderId: string, eventName: Extract<MetaEventName, "Lead" | "Purchase">) {
  const { data: order } = await admin
    .from("orders")
    .select(
      "id, store_id, order_number, created_at, total, customer_name, customer_phone, customer_id, district_name, department_name, order_items (product_id, product_name, quantity), order_attribution (fbc, fbp, client_ip, user_agent, landing_url)",
    )
    .eq("id", orderId)
    .single();
  if (!order) return null;

  const settings = await getSettings(admin, order.store_id);
  if (!settings?.enabled || !settings.pixel_id || !settings.capi_token_encrypted) return null;
  if (eventName === "Lead" && !settings.send_lead) return null;
  if (eventName === "Purchase" && !settings.send_purchase) return null;

  const attr = (Array.isArray(order.order_attribution) ? order.order_attribution[0] : order.order_attribution) as {
    fbc: string | null;
    fbp: string | null;
    client_ip: string | null;
    user_agent: string | null;
    landing_url: string | null;
  } | null;
  const item = (order.order_items as { product_id: string | null; product_name: string; quantity: number }[])[0];
  const [firstName, ...rest] = String(order.customer_name).split(" ");

  const eventId = eventName === "Lead" ? leadEventId(order.id) : purchaseEventId(order.id);
  const payload: ServerEvent = buildServerEvent({
    eventName,
    eventId,
    // Purchase: la conversión ocurre AHORA (entrega), no cuando se hizo el pedido.
    eventTime: eventName === "Lead" ? new Date(order.created_at) : new Date(),
    sourceUrl: attr?.landing_url,
    userData: buildUserData({
      phone: order.customer_phone,
      firstName,
      lastName: rest.join(" ") || null,
      city: order.district_name,
      region: order.department_name,
      externalId: order.customer_id,
      clientIp: attr?.client_ip,
      userAgent: attr?.user_agent,
      fbc: attr?.fbc,
      fbp: attr?.fbp,
    }),
    value: Number(order.total),
    productId: item?.product_id,
    productName: item?.product_name,
    quantity: item?.quantity,
    orderNumber: order.order_number,
  });

  const { data: inserted } = await admin
    .from("marketing_events")
    .upsert(
      {
        store_id: order.store_id,
        order_id: order.id,
        platform: "meta",
        event_name: eventName,
        event_id: eventId,
        event_time: new Date(payload.event_time * 1000).toISOString(),
        action_source: "website",
        payload,
      },
      { onConflict: "store_id,platform,event_id", ignoreDuplicates: true },
    )
    .select("id");

  const id = inserted?.[0]?.id as string | undefined;
  if (!id) return null; // ya existía: nunca se envía dos veces
  await sendMarketingEvent(admin, id);
  return id;
}

/** Envía un evento de la bandeja a Meta y registra el resultado. */
export async function sendMarketingEvent(admin: SupabaseClient, marketingEventId: string): Promise<boolean> {
  const { data: row } = await admin
    .from("marketing_events")
    .select("id, store_id, payload, status, attempts, event_name")
    .eq("id", marketingEventId)
    .single();
  if (!row || row.status === "sent" || row.status === "skipped" || row.attempts >= MAX_ATTEMPTS) return false;

  const settings = await getSettings(admin, row.store_id);
  const fail = async (message: string, response?: unknown, final = false) => {
    await admin
      .from("marketing_events")
      .update({
        status: final ? "skipped" : "failed",
        attempts: row.attempts + 1,
        last_error: message.slice(0, 1000),
        response: response ?? null,
      })
      .eq("id", row.id);
    // Aviso en la campana cuando el evento ya no se reintentará (o agotó los intentos)
    if (final || row.attempts + 1 >= MAX_ATTEMPTS) {
      await admin.from("notifications").insert({
        store_id: row.store_id,
        type: "meta_failed",
        title: `Meta no recibió un evento ${row.event_name}`,
        body: message.slice(0, 300),
        link: "/dashboard/marketing",
      });
    }
    return false;
  };

  if (!settings?.enabled || !settings.pixel_id || !settings.capi_token_encrypted) {
    return fail("Meta no está configurado o está desactivado", undefined, true);
  }
  const payload = row.payload as ServerEvent;
  if (isTooOld(payload.event_time)) return fail("El evento tiene más de 7 días: Meta ya no lo acepta", undefined, true);

  let token: string;
  try {
    token = decryptSecret(settings.capi_token_encrypted);
  } catch {
    return fail("No se pudo descifrar el token de Conversions API", undefined, true);
  }

  try {
    const res = await fetch(`https://graph.facebook.com/${META_GRAPH_VERSION}/${settings.pixel_id}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        data: [payload],
        access_token: token,
        ...(settings.test_event_code ? { test_event_code: settings.test_event_code } : {}),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const json = (await res.json().catch(() => ({}))) as { events_received?: number; error?: { message?: string; code?: number } };
    if (!res.ok || json.error) {
      // 190 = token inválido/expirado → no reintentar automáticamente
      const final = json.error?.code === 190;
      return fail(json.error?.message ?? `HTTP ${res.status}`, json, final);
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

/** Reintenta eventos fallidos/pendientes (cron). */
export async function retryMarketingEvents(admin: SupabaseClient, limit = 50) {
  const { data } = await admin
    .from("marketing_events")
    .select("id")
    .in("status", ["pending", "failed"])
    .lt("attempts", MAX_ATTEMPTS)
    .order("created_at")
    .limit(limit);
  let sent = 0;
  for (const row of data ?? []) if (await sendMarketingEvent(admin, row.id)) sent++;
  return { processed: data?.length ?? 0, sent };
}

/** Llamar después de cada cambio de estado: si llegó a la venta real (por zona), registra y envía Purchase. */
export async function maybeSendPurchase(admin: SupabaseClient, orderId: string) {
  const { data: order } = await admin
    .from("orders")
    .select("id, store_id, status, zone, delivered_at, collected_at")
    .eq("id", orderId)
    .single();
  if (!order) return null;
  const { data: settings } = await admin.from("store_settings").select("real_sale_mode").eq("store_id", order.store_id).single();
  if (!isRealSale(order, parseSaleMode(settings?.real_sale_mode))) return null;
  return enqueueOrderEvent(admin, orderId, "Purchase");
}
