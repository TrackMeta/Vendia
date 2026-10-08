"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { requireOwner } from "@/lib/auth";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { buildServerEvent, META_GRAPH_VERSION } from "@/modules/meta/events";
import { sendMarketingEvent } from "@/modules/meta/capi";
import { type AdAccount, createPixel, inspectToken, listPixels, MetaApiError, type Pixel } from "@/modules/meta/marketing-api";
import { FIRST_SYNC_DAYS, syncMetaStore } from "@/modules/meta/sync";
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

// ─────────────────────────────────────────────────────────────────────
// Conectar Meta con un token de usuario del sistema
// ─────────────────────────────────────────────────────────────────────

const tokenSchema = z.string().trim().min(50, "El token parece incompleto: cópialo completo").max(1000);
const accountSchema = z.string().regex(/^act_\d{5,25}$/, "Cuenta publicitaria inválida");

const metaError = (e: unknown) => (e instanceof MetaApiError ? e.message : "No se pudo conectar con Meta");

export type TokenCheck = { ok: true; userName: string; accounts: AdAccount[] } | { ok: false; error: string };

/** Paso 1: valida el token y lista las cuentas publicitarias (el token no se guarda todavía). */
export async function checkMetaToken(token: string): Promise<TokenCheck> {
  await requireOwner();
  const t = tokenSchema.safeParse(token);
  if (!t.success) return { ok: false, error: t.error.issues[0].message };
  try {
    const r = await inspectToken(t.data);
    if (!r.accounts.length) {
      return { ok: false, error: "El token no tiene cuentas publicitarias asignadas. En el Business Manager, asígnale tu cuenta al usuario del sistema." };
    }
    return { ok: true, ...r };
  } catch (e) {
    return { ok: false, error: metaError(e) };
  }
}

/** Paso 2: Pixels de la cuenta elegida. */
export async function getMetaPixels(token: string, adAccountId: string): Promise<{ ok: true; pixels: Pixel[] } | { ok: false; error: string }> {
  await requireOwner();
  const t = tokenSchema.safeParse(token);
  const a = accountSchema.safeParse(adAccountId);
  if (!t.success || !a.success) return { ok: false, error: "Datos inválidos" };
  try {
    return { ok: true, pixels: await listPixels(t.data, a.data) };
  } catch (e) {
    return { ok: false, error: metaError(e) };
  }
}

/** Paso 3: guarda la conexión (token cifrado), elige o crea el Pixel, activa las conversiones y hace la primera sincronización. */
export async function connectMeta(input: { token: string; adAccountId: string; pixelId?: string; newPixelName?: string }): Promise<ActionResult> {
  const { store } = await requireOwner();
  const parsed = z
    .object({
      token: tokenSchema,
      adAccountId: accountSchema,
      pixelId: z
        .string()
        .regex(/^\d{5,20}$/)
        .optional(),
      newPixelName: z.string().trim().min(2).max(100).optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const d = parsed.data;
  if (!d.pixelId && !d.newPixelName) return { ok: false, error: "Elige un Pixel o crea uno nuevo" };

  let account: AdAccount | undefined;
  let userName: string;
  let pixelId: string;
  try {
    // Se vuelve a validar en el servidor: no se confía en lo que manda el navegador
    const info = await inspectToken(d.token);
    userName = info.userName;
    account = info.accounts.find((x) => x.id === d.adAccountId);
    if (!account) return { ok: false, error: "Ese token no tiene acceso a esa cuenta publicitaria" };
    if (d.pixelId) {
      const pixels = await listPixels(d.token, account.id);
      if (!pixels.some((p) => p.id === d.pixelId)) return { ok: false, error: "Ese Pixel no pertenece a la cuenta elegida" };
      pixelId = d.pixelId;
    } else {
      pixelId = await createPixel(d.token, account.id, d.newPixelName ?? store.name);
    }
  } catch (e) {
    return { ok: false, error: metaError(e) };
  }

  const admin = createAdminClient();
  const values = {
    pixel_id: pixelId,
    capi_token_encrypted: encryptSecret(d.token),
    enabled: true,
    ad_account_id: account.id,
    ad_account_name: account.name.slice(0, 200),
    ad_account_currency: account.currency,
    meta_user_name: userName.slice(0, 200),
    connected_at: new Date().toISOString(),
    sync_enabled: true,
    last_sync_error: null,
  };
  const { error } = await admin.from("store_meta_settings").upsert({ store_id: store.id, ...values }, { onConflict: "store_id" });
  if (error) return { ok: false, error: "No se pudo guardar la conexión" };
  if (account.currency === "PEN" || account.currency === "USD") {
    await admin.from("store_settings").update({ ad_currency: account.currency }).eq("store_id", store.id);
  }

  after(async () => {
    try {
      await syncMetaStore(createAdminClient(), store.id, FIRST_SYNC_DAYS);
    } catch (e) {
      console.error("Primera sincronización de Meta", e);
    }
  });
  await revalidateStoreLandings(store.id, store.slug);
  revalidatePath("/dashboard/marketing");
  return { ok: true, message: `Conectado a ${account.name}. Estamos trayendo los últimos ${FIRST_SYNC_DAYS} días de tus campañas.` };
}

/** Botón «Actualizar ahora»: últimos 7 días. */
export async function syncMetaNow(): Promise<ActionResult> {
  const { store } = await requireOwner();
  const r = await syncMetaStore(createAdminClient(), store.id, 7);
  revalidatePath("/dashboard/marketing");
  revalidatePath("/dashboard/rendimiento");
  revalidatePath("/dashboard");
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, message: `Actualizado: ${r.rows} filas · gasto S/ ${r.spend.toFixed(2)} (últimos 7 días)` };
}

/** Desconecta la cuenta publicitaria (deja de sincronizar). El Pixel y el historial se conservan. */
export async function disconnectMeta(): Promise<ActionResult> {
  const { store } = await requireOwner();
  const { error } = await createAdminClient()
    .from("store_meta_settings")
    .update({ ad_account_id: null, ad_account_name: null, ad_account_currency: null, connected_at: null, sync_enabled: false })
    .eq("store_id", store.id);
  if (error) return { ok: false, error: "No se pudo desconectar" };
  revalidatePath("/dashboard/marketing");
  return { ok: true, message: "Cuenta publicitaria desconectada. Tus datos anteriores se conservan." };
}
