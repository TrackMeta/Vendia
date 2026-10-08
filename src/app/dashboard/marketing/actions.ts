"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { z } from "zod";
import { requireOwner } from "@/lib/auth";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { buildServerEvent, META_GRAPH_VERSION } from "@/modules/meta/events";
import { sendMarketingEvent } from "@/modules/meta/capi";
import { landingCacheTag } from "@/modules/landing/public-data";

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

const schema = z.object({
  pixel_id: z
    .string()
    .trim()
    .regex(/^\d{5,20}$/, "El Pixel ID son solo números (15-16 dígitos normalmente)")
    .or(z.literal(""))
    .transform((v) => v || null),
  token: z.string().trim().max(1000).optional(),
  clear_token: z.literal("on").optional(),
  test_event_code: z
    .string()
    .trim()
    .max(40)
    .optional()
    .transform((v) => v || null),
  enabled: z.literal("on").optional(),
  send_lead: z.literal("on").optional(),
  send_purchase: z.literal("on").optional(),
});

async function revalidateStoreLandings(storeId: string, storeSlug: string) {
  const supabase = await createClient();
  const { data } = await supabase.from("landing_pages").select("slug").eq("store_id", storeId);
  for (const l of data ?? []) revalidateTag(landingCacheTag(storeSlug, l.slug), { expire: 0 });
}

export async function saveMetaSettings(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  const { store } = await requireOwner();
  const parsed = schema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const d = parsed.data;
  if (d.enabled && !d.pixel_id) return { ok: false, error: "Para activar Meta necesitas el Pixel ID" };

  const row: Record<string, unknown> = {
    store_id: store.id,
    pixel_id: d.pixel_id,
    test_event_code: d.test_event_code,
    enabled: Boolean(d.enabled),
    send_lead: Boolean(d.send_lead),
    send_purchase: Boolean(d.send_purchase),
  };
  if (d.token) {
    if (d.token.length < 50) return { ok: false, error: "El token de acceso parece incompleto. Cópialo completo desde Events Manager." };
    row.capi_token_encrypted = encryptSecret(d.token);
  } else if (d.clear_token) {
    row.capi_token_encrypted = null;
  }

  // Insert o update explícito: la columna store_id no es actualizable desde el cliente (por seguridad).
  const supabase = await createClient();
  const { data: existing } = await supabase.from("store_meta_settings").select("store_id").eq("store_id", store.id).maybeSingle();
  const { store_id: _storeId, ...changes } = row;
  void _storeId;
  const { error } = existing
    ? await supabase.from("store_meta_settings").update(changes).eq("store_id", store.id)
    : await supabase.from("store_meta_settings").insert(row);
  if (error) return { ok: false, error: "No se pudo guardar la configuración de Meta" };

  await revalidateStoreLandings(store.id, store.slug);
  revalidatePath("/dashboard/marketing");
  return { ok: true, message: "Configuración de Meta guardada" };
}

/** Envía un PageView de prueba por Conversions API (requiere código de prueba de Events Manager). */
export async function sendTestEvent(): Promise<ActionResult> {
  const { store } = await requireOwner();
  const admin = createAdminClient();
  const { data: s } = await admin
    .from("store_meta_settings")
    .select("pixel_id, capi_token_encrypted, test_event_code")
    .eq("store_id", store.id)
    .maybeSingle();
  if (!s?.pixel_id || !s.capi_token_encrypted) return { ok: false, error: "Primero guarda tu Pixel ID y el token de acceso" };
  if (!s.test_event_code) return { ok: false, error: "Agrega el código de prueba (Events Manager → Probar eventos) para no mezclar la prueba con tus datos reales" };

  const event = buildServerEvent({
    eventName: "PageView",
    eventId: `test_${Date.now()}`,
    eventTime: new Date(),
    sourceUrl: `${process.env.NEXT_PUBLIC_SITE_URL ?? "https://vendia.app"}/p/${store.slug}`,
    userData: { client_user_agent: "Vendia test", client_ip_address: "190.0.0.1" },
  });
  try {
    const res = await fetch(`https://graph.facebook.com/${META_GRAPH_VERSION}/${s.pixel_id}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: [event], access_token: decryptSecret(s.capi_token_encrypted), test_event_code: s.test_event_code }),
      signal: AbortSignal.timeout(10_000),
    });
    const json = (await res.json().catch(() => ({}))) as { events_received?: number; error?: { message?: string } };
    if (!res.ok || json.error) return { ok: false, error: `Meta respondió: ${json.error?.message ?? `HTTP ${res.status}`}` };
    return { ok: true, message: `Meta recibió ${json.events_received ?? 1} evento de prueba. Revísalo en Events Manager → Probar eventos.` };
  } catch {
    return { ok: false, error: "No se pudo conectar con Meta" };
  }
}

export async function retryFailedEvents(): Promise<ActionResult> {
  const { store } = await requireOwner();
  const admin = createAdminClient();
  const { data } = await admin
    .from("marketing_events")
    .select("id")
    .eq("store_id", store.id)
    .eq("status", "failed")
    .lt("attempts", 5)
    .limit(50);
  let sent = 0;
  for (const row of data ?? []) if (await sendMarketingEvent(admin, row.id)) sent++;
  revalidatePath("/dashboard/marketing");
  return { ok: true, message: `Reintentados ${data?.length ?? 0} · enviados ${sent}` };
}
