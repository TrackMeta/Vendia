import { after, NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { decryptSecret, hmacSha256Hex, safeEqual } from "@/lib/crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { genericWebhookPayload, mapStatus, parseSignatureHeader } from "@/modules/integrations/webhook";
import { maybeSendPurchase } from "@/modules/meta/capi";

const SUPPORTED = new Set(["generic_webhook"]);
const MAX_BODY = 64 * 1024;

/**
 * Webhooks entrantes de integraciones (couriers, automatizaciones).
 * Seguridad: firma HMAC-SHA256 por tienda · idempotencia por event_id · logs de cada llamada.
 */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/webhooks/[provider]/[storeId]">) {
  const { provider, storeId } = await ctx.params;
  if (!SUPPORTED.has(provider) || !z.uuid().safeParse(storeId).success) {
    return NextResponse.json({ error: "Integración no encontrada" }, { status: 404 });
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY) return NextResponse.json({ error: "Cuerpo demasiado grande" }, { status: 413 });

  const admin = createAdminClient();
  const log = (success: boolean, statusCode: number, message: string, details?: unknown, orderId?: string) =>
    admin.from("integration_logs").insert({
      store_id: storeId,
      provider,
      direction: "inbound",
      operation: "webhook",
      order_id: orderId ?? null,
      success,
      status_code: statusCode,
      message: message.slice(0, 500),
      details: details ?? null,
    });

  const { data: integration } = await admin
    .from("integrations")
    .select("id, status, webhook_secret_encrypted")
    .eq("store_id", storeId)
    .eq("provider", provider)
    .maybeSingle();
  if (!integration || integration.status !== "active" || !integration.webhook_secret_encrypted) {
    return NextResponse.json({ error: "Integración no encontrada o desactivada" }, { status: 404 });
  }

  // 1. Firma
  const signature = parseSignatureHeader(request.headers.get("x-vendia-signature"));
  let secret: string;
  try {
    secret = decryptSecret(integration.webhook_secret_encrypted);
  } catch {
    await log(false, 500, "No se pudo descifrar el secreto del webhook");
    return NextResponse.json({ error: "Error de configuración" }, { status: 500 });
  }
  if (!signature || !safeEqual(signature, hmacSha256Hex(secret, raw))) {
    await log(false, 401, "Firma inválida");
    return NextResponse.json({ error: "Firma inválida" }, { status: 401 });
  }

  // 2. Validación del cuerpo
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    await log(false, 400, "JSON inválido");
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  const parsed = genericWebhookPayload.safeParse(json);
  if (!parsed.success) {
    await log(false, 422, parsed.error.issues[0]?.message ?? "Cuerpo inválido", json);
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Cuerpo inválido" }, { status: 422 });
  }
  const payload = parsed.data;
  const status = mapStatus(payload.status);
  if (!status) {
    await log(false, 422, `Estado desconocido: ${payload.status}`, payload);
    return NextResponse.json({ error: `Estado desconocido: ${payload.status}` }, { status: 422 });
  }

  // 3. Idempotencia
  const { data: event } = await admin
    .from("webhook_events")
    .upsert(
      { provider, store_id: storeId, external_event_id: payload.event_id, signature_valid: true, payload },
      { onConflict: "provider,store_id,external_event_id", ignoreDuplicates: true },
    )
    .select("id");
  const eventRowId = event?.[0]?.id as string | undefined;
  if (!eventRowId) return NextResponse.json({ ok: true, duplicate: true });

  // 4. Aplicar el cambio de estado
  const { data: result, error } = await admin.rpc("apply_integration_status", {
    p_store_id: storeId,
    p_order_number: payload.order_number ?? null,
    p_external_order_id: payload.external_order_id ?? null,
    p_to: status,
    p_note: payload.note ?? `Webhook ${provider}`,
    p_tracking_code: payload.tracking_code ?? null,
    p_courier_name: payload.courier_name ?? null,
  });

  if (error) {
    const message = error.code === "P0002" ? "Pedido no encontrado" : error.code === "P0001" ? error.message : "Error al aplicar el estado";
    await admin.from("webhook_events").update({ error: message, processed_at: new Date().toISOString() }).eq("id", eventRowId);
    await log(false, 422, message, payload);
    return NextResponse.json({ error: message }, { status: 422 });
  }

  const { order_id, changed } = result as { order_id: string; changed: boolean };
  await admin.from("webhook_events").update({ processed_at: new Date().toISOString() }).eq("id", eventRowId);
  await log(true, 200, changed ? `Estado → ${status}` : "Sin cambios", payload, order_id);

  if (changed) {
    after(async () => {
      try {
        await maybeSendPurchase(admin, order_id);
      } catch (e) {
        console.error("CAPI Purchase (webhook)", e);
      }
    });
  }
  return NextResponse.json({ ok: true, order_id, status, changed });
}
