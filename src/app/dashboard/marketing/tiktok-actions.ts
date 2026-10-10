"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { z } from "zod";
import { requireOwner } from "@/lib/auth";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { landingCacheTag } from "@/modules/landing/public-data";
import { buildTikTokEvent, TIKTOK_EVENTS_URL } from "@/modules/tiktok/events";

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

const schema = z.object({
  pixel_code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{10,40}$/, "El Pixel code de TikTok son letras y números (ej. C4ABCD123...)")
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

/** Guarda la configuración de TikTok. El token se cifra y nunca vuelve al navegador. */
export async function saveTikTokSettings(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  const { store } = await requireOwner();
  const parsed = schema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const d = parsed.data;
  if (d.enabled && !d.pixel_code) return { ok: false, error: "Para activar TikTok necesitas el Pixel code" };

  const row: Record<string, unknown> = {
    store_id: store.id,
    pixel_code: d.pixel_code,
    test_event_code: d.test_event_code,
    enabled: Boolean(d.enabled),
    send_lead: Boolean(d.send_lead),
    send_purchase: Boolean(d.send_purchase),
  };
  if (d.token) {
    if (d.token.length < 20) return { ok: false, error: "El token de TikTok parece incompleto" };
    row.access_token_encrypted = encryptSecret(d.token);
  } else if (d.clear_token) {
    row.access_token_encrypted = null;
  }

  const admin = createAdminClient();
  const { error } = await admin.from("store_tiktok_settings").upsert(row, { onConflict: "store_id" });
  if (error) return { ok: false, error: "No se pudo guardar la configuración de TikTok" };

  const { data: landings } = await admin.from("landing_pages").select("slug").eq("store_id", store.id);
  for (const l of landings ?? []) revalidateTag(landingCacheTag(store.slug, l.slug), { expire: 0 });
  revalidatePath("/dashboard/marketing");
  return { ok: true, message: "Configuración de TikTok guardada" };
}

/**
 * Envía un evento de prueba a TikTok (Events API) con el código de prueba, para verlo en
 * TikTok Events Manager → Probar eventos. No se guarda en la bandeja ni cuenta como venta.
 */
export async function sendTikTokTestEvent(): Promise<ActionResult> {
  const { store } = await requireOwner();
  const { data: s } = await createAdminClient()
    .from("store_tiktok_settings")
    .select("pixel_code, access_token_encrypted, test_event_code")
    .eq("store_id", store.id)
    .maybeSingle();
  if (!s?.pixel_code || !s.access_token_encrypted) return { ok: false, error: "Primero guarda tu Pixel code y el access token de TikTok" };
  if (!s.test_event_code) return { ok: false, error: "Agrega el código de prueba (TikTok Events Manager → Probar eventos) para no mezclar la prueba con tus datos reales" };

  const event = buildTikTokEvent({
    event: "SubmitForm",
    eventId: `test_${Date.now()}`,
    eventTime: new Date(),
    phone: "51900000000",
    value: 1,
    url: `${process.env.NEXT_PUBLIC_SITE_URL ?? "https://vendia.app"}/p/${store.slug}`,
  });
  try {
    const res = await fetch(TIKTOK_EVENTS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Access-Token": decryptSecret(s.access_token_encrypted) },
      body: JSON.stringify({ event_source: "web", event_source_id: s.pixel_code, test_event_code: s.test_event_code, data: [event] }),
      signal: AbortSignal.timeout(10_000),
    });
    const json = (await res.json().catch(() => ({}))) as { code?: number; message?: string };
    if (!res.ok || (json.code !== undefined && json.code !== 0)) return { ok: false, error: `TikTok respondió: ${json.message ?? `HTTP ${res.status}`}` };
    return { ok: true, message: "TikTok recibió el evento de prueba. Revísalo en Events Manager → Probar eventos." };
  } catch {
    return { ok: false, error: "No se pudo conectar con TikTok" };
  }
}
