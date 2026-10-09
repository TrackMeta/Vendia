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
import { reportError } from "@/lib/report-error";
import { type AdAccount, createPixel, grantAdAccountAccess, inspectToken, listPixels, MetaApiError, type Pixel, cleanToken, tokenPermissions } from "@/modules/meta/marketing-api";
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

const REQUIRED_PERMISSIONS = ["ads_read", "ads_management", "business_management"];

/** Le pregunta a Meta qué permisos tiene el token para decir exactamente cuál falta. */
async function missingPermissions(token: string): Promise<string | null> {
  try {
    const granted = await tokenPermissions(token);
    const missing = REQUIRED_PERMISSIONS.filter((p) => !granted.includes(p));
    return missing.length
      ? `Al token le faltan estos permisos: ${missing.join(", ")}. En Usuarios del sistema → «Generar nuevo token», elige tu app y márcalos.`
      : null;
  } catch {
    return null;
  }
}

/** Deja registro del fallo (nunca el token) para poder ayudar al vendedor. */
async function logMetaFailure(step: string, e: unknown, shown: string) {
  const code = e instanceof MetaApiError ? ` [código ${e.code ?? "?"}]` : "";
  await reportError({ source: "server", message: `Conectar Meta · ${step}${code}: ${shown}`, path: "/dashboard/marketing" });
}

/** Token pegado ahora o, si viene vacío, el que ya está guardado (cifrado) para esta tienda. */
async function resolveToken(storeId: string, token: string | undefined): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
  if (token?.trim()) {
    const t = tokenSchema.safeParse(cleanToken(token));
    return t.success ? { ok: true, token: t.data } : { ok: false, error: t.error.issues[0].message };
  }
  const { data } = await createAdminClient().from("store_meta_settings").select("capi_token_encrypted").eq("store_id", storeId).maybeSingle();
  if (!data?.capi_token_encrypted) return { ok: false, error: "Primero pega el token de tu usuario del sistema" };
  return { ok: true, token: decryptSecret(data.capi_token_encrypted) };
}

/** needsBusinessId: el token funciona pero no sabemos cuál es su Business Manager → pedir su ID. */
export type TokenCheck = { ok: true; userName: string; accounts: AdAccount[] } | { ok: false; error: string; needsBusinessId?: boolean };

const businessIdSchema = z
  .string()
  .trim()
  .regex(/^\d{5,25}$/, "El ID del Business Manager son solo números")
  .optional()
  .or(z.literal("").transform(() => undefined));

/** Paso 1: valida el token y lista las cuentas publicitarias (el token no se guarda todavía). Vacío = token guardado. */
export async function checkMetaToken(token: string, businessId?: string): Promise<TokenCheck> {
  const { store } = await requireOwner();
  const t = await resolveToken(store.id, token);
  if (!t.ok) return t;
  const b = businessIdSchema.safeParse(businessId);
  if (!b.success) return { ok: false, error: b.error.issues[0].message, needsBusinessId: true };
  try {
    const { userName, accounts } = await inspectToken(t.token, fetch, b.data);
    if (!accounts.length) {
      const missing = await missingPermissions(t.token);
      if (missing) {
        await logMetaFailure("permisos", null, missing);
        return { ok: false, error: missing };
      }
      const error = b.data
        ? "Con ese ID no encontramos cuentas publicitarias. Revisa que sea el ID de tu Business Manager y que el usuario del sistema tenga rol Administrador (o asígnale la cuenta en «Asignar activos»)."
        : "Tu token funciona, pero Meta no nos dice cuál es tu Business Manager. Pega su ID abajo y Vendia buscará todas tus cuentas publicitarias.";
      await logMetaFailure(b.data ? "sin cuentas con ID de negocio" : "sin cuentas", null, error);
      return { ok: false, error, needsBusinessId: true };
    }
    return { ok: true, userName, accounts };
  } catch (e) {
    const error = (await missingPermissions(t.token)) ?? metaError(e);
    await logMetaFailure("verificar token", e, error);
    return { ok: false, error };
  }
}

/** Paso 2: Pixels de la cuenta elegida. Si la cuenta es nueva (no asignada), Vendia primero se da acceso. */
export async function getMetaPixels(token: string, adAccountId: string, businessId?: string): Promise<{ ok: true; pixels: Pixel[]; granted: boolean } | { ok: false; error: string }> {
  const { store } = await requireOwner();
  const t = await resolveToken(store.id, token);
  if (!t.ok) return t;
  const a = accountSchema.safeParse(adAccountId);
  if (!a.success) return { ok: false, error: "Datos inválidos" };
  let granted = false;
  try {
    const b = businessIdSchema.safeParse(businessId);
    const info = await inspectToken(t.token, fetch, b.success ? b.data : undefined);
    const account = info.accounts.find((x) => x.id === a.data);
    if (!account) return { ok: false, error: "Ese token no tiene acceso a esa cuenta publicitaria" };
    if (!account.assigned && account.businessId) {
      try {
        await grantAdAccountAccess(t.token, account.id, account.businessId, info.userId);
        granted = true;
      } catch (e) {
        console.error("Meta: asignar cuenta al usuario del sistema", e);
        return {
          ok: false,
          error:
            "Meta no dejó que Vendia se dé acceso a esta cuenta. En el Business Manager, dale al usuario del sistema el rol de Administrador (o asígnale esta cuenta) y vuelve a intentar.",
        };
      }
    }
    return { ok: true, pixels: await listPixels(t.token, account.id), granted };
  } catch (e) {
    return { ok: false, error: metaError(e) };
  }
}

const accountsSchema = z.array(accountSchema).min(1, "Elige al menos una cuenta publicitaria").max(25, "Máximo 25 cuentas por tienda");

/**
 * Cuentas elegidas que el usuario del sistema aún no tiene asignadas: Vendia se da acceso
 * (requiere usuario del sistema Administrador). Devuelve las cuentas listas o el error para mostrar.
 */
async function ensureAccess(token: string, info: Awaited<ReturnType<typeof inspectToken>>, ids: string[]): Promise<{ ok: true; accounts: AdAccount[] } | { ok: false; error: string }> {
  const chosen: AdAccount[] = [];
  for (const id of ids) {
    const account = info.accounts.find((x) => x.id === id);
    if (!account) return { ok: false, error: `El token no tiene acceso a la cuenta ${id}` };
    if (!account.assigned) {
      if (!account.businessId) return { ok: false, error: `No sabemos a qué Business Manager pertenece ${account.name}` };
      try {
        await grantAdAccountAccess(token, account.id, account.businessId, info.userId);
      } catch (e) {
        const error = `Meta no dejó que Vendia se dé acceso a «${account.name}». Dale al usuario del sistema el rol de Administrador en tu Business Manager (o asígnale esa cuenta) y vuelve a intentar.`;
        await logMetaFailure("asignar cuenta", e, error);
        return { ok: false, error };
      }
    }
    chosen.push({ ...account, assigned: true });
  }
  return { ok: true, accounts: chosen };
}

/** Deja en store_meta_accounts exactamente las cuentas elegidas (las quitadas dejan de sincronizarse; su historial queda). */
async function saveAccounts(storeId: string, accounts: AdAccount[]) {
  const admin = createAdminClient();
  const ids = accounts.map((a) => a.id);
  await admin
    .from("store_meta_accounts")
    .delete()
    .eq("store_id", storeId)
    .not("ad_account_id", "in", `(${ids.map((i) => `"${i}"`).join(",")})`);
  const { error } = await admin.from("store_meta_accounts").upsert(
    accounts.map((a) => ({ store_id: storeId, ad_account_id: a.id, name: a.name.slice(0, 200), currency: a.currency, enabled: true })),
    { onConflict: "store_id,ad_account_id" },
  );
  return error;
}

/**
 * Paso 3: guarda la conexión (token cifrado) con una o varias cuentas publicitarias. La primera es la
 * principal: de ahí sale el Pixel. Activa las conversiones y trae los últimos días de todas las cuentas.
 */
export async function connectMeta(input: {
  token: string;
  adAccountIds: string[];
  pixelId?: string;
  newPixelName?: string;
  businessId?: string;
}): Promise<ActionResult> {
  const { store } = await requireOwner();
  const parsed = z
    .object({
      token: z.string().max(1000),
      adAccountIds: accountsSchema,
      pixelId: z
        .string()
        .regex(/^\d{5,20}$/)
        .optional(),
      newPixelName: z.string().trim().min(2).max(100).optional(),
      businessId: businessIdSchema,
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const d = parsed.data;
  if (!d.pixelId && !d.newPixelName) return { ok: false, error: "Elige un Pixel o crea uno nuevo" };
  const t = await resolveToken(store.id, d.token);
  if (!t.ok) return t;
  const token = t.token;
  const ids = [...new Set(d.adAccountIds)];

  let accounts: AdAccount[];
  let userName: string;
  let pixelId: string;
  try {
    // Se vuelve a validar en el servidor: no se confía en lo que manda el navegador
    const info = await inspectToken(token, fetch, d.businessId);
    userName = info.userName;
    const access = await ensureAccess(token, info, ids);
    if (!access.ok) return access;
    accounts = access.accounts;
    if (d.pixelId) {
      const pixels = await listPixels(token, accounts[0].id);
      if (!pixels.some((p) => p.id === d.pixelId)) return { ok: false, error: "Ese Pixel no pertenece a la cuenta principal" };
      pixelId = d.pixelId;
    } else {
      pixelId = await createPixel(token, accounts[0].id, d.newPixelName ?? store.name);
    }
  } catch (e) {
    const error = metaError(e);
    await logMetaFailure("conectar", e, error);
    return { ok: false, error };
  }

  const primary = accounts[0];
  const admin = createAdminClient();
  const { error } = await admin.from("store_meta_settings").upsert(
    {
      store_id: store.id,
      pixel_id: pixelId,
      capi_token_encrypted: encryptSecret(token),
      enabled: true,
      ad_account_id: primary.id,
      ad_account_name: primary.name.slice(0, 200),
      ad_account_currency: primary.currency,
      meta_user_name: userName.slice(0, 200),
      connected_at: new Date().toISOString(),
      sync_enabled: true,
      last_sync_error: null,
    },
    { onConflict: "store_id" },
  );
  if (error || (await saveAccounts(store.id, accounts))) return { ok: false, error: "No se pudo guardar la conexión" };
  if (primary.currency === "PEN" || primary.currency === "USD") {
    await admin.from("store_settings").update({ ad_currency: primary.currency }).eq("store_id", store.id);
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
  const names = accounts.length === 1 ? primary.name : `${accounts.length} cuentas`;
  return { ok: true, message: `Conectado a ${names}. Estamos trayendo los últimos ${FIRST_SYNC_DAYS} días de tus campañas.` };
}

/**
 * Agregar o quitar cuentas con el token ya guardado (sin volver a pegarlo). Las nuevas traen sus
 * últimos días; las quitadas dejan de sincronizarse (su historial se conserva).
 */
export async function updateMetaAccounts(input: { adAccountIds: string[]; businessId?: string }): Promise<ActionResult> {
  const { store } = await requireOwner();
  const parsed = z.object({ adAccountIds: accountsSchema, businessId: businessIdSchema }).safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const t = await resolveToken(store.id, "");
  if (!t.ok) return t;
  const ids = [...new Set(parsed.data.adAccountIds)];

  const admin = createAdminClient();
  const [{ data: before }, { data: settings }] = await Promise.all([
    admin.from("store_meta_accounts").select("ad_account_id").eq("store_id", store.id),
    admin.from("store_meta_settings").select("ad_account_id").eq("store_id", store.id).maybeSingle(),
  ]);

  let accounts: AdAccount[];
  try {
    const info = await inspectToken(t.token, fetch, parsed.data.businessId);
    const access = await ensureAccess(t.token, info, ids);
    if (!access.ok) return access;
    accounts = access.accounts;
  } catch (e) {
    const error = metaError(e);
    await logMetaFailure("cambiar cuentas", e, error);
    return { ok: false, error };
  }
  if (await saveAccounts(store.id, accounts)) return { ok: false, error: "No se pudieron guardar las cuentas" };

  // Si se quitó la cuenta principal, la primera elegida pasa a serlo (el Pixel no cambia)
  if (!ids.includes(settings?.ad_account_id ?? "")) {
    const primary = accounts[0];
    await admin
      .from("store_meta_settings")
      .update({ ad_account_id: primary.id, ad_account_name: primary.name.slice(0, 200), ad_account_currency: primary.currency, sync_enabled: true })
      .eq("store_id", store.id);
  }

  // Antes de «varias cuentas» la principal no estaba en la tabla: no se cuenta como nueva
  const known = new Set([...(before ?? []).map((b) => b.ad_account_id as string), settings?.ad_account_id ?? ""]);
  const added = ids.filter((id) => !known.has(id));
  if (added.length) {
    after(async () => {
      try {
        await syncMetaStore(createAdminClient(), store.id, FIRST_SYNC_DAYS, fetch, added);
      } catch (e) {
        console.error("Sincronización de cuentas nuevas de Meta", e);
      }
    });
  }
  revalidatePath("/dashboard/marketing");
  revalidatePath("/dashboard/rendimiento");
  const removed = [...known].filter((id) => id && !ids.includes(id)).length;
  const parts = [added.length ? `${added.length} agregada(s): trayendo sus últimos ${FIRST_SYNC_DAYS} días` : "", removed ? `${removed} quitada(s)` : ""].filter(Boolean);
  return { ok: true, message: `Cuentas actualizadas${parts.length ? ` · ${parts.join(" · ")}` : ""}.` };
}

/** Botón «Actualizar ahora»: últimos 7 días. */
export async function syncMetaNow(): Promise<ActionResult> {
  const { store } = await requireOwner();
  const r = await syncMetaStore(createAdminClient(), store.id, 7);
  revalidatePath("/dashboard/marketing");
  revalidatePath("/dashboard/rendimiento");
  revalidatePath("/dashboard");
  if (!r.ok) return { ok: false, error: r.error };
  const cuentas = r.accounts === 1 ? "1 cuenta" : `${r.accounts} cuentas`;
  const fallas = r.failed.length ? ` · no se pudo leer: ${r.failed.map((x) => x.account).join(", ")}` : "";
  return { ok: true, message: `Actualizado (${cuentas}): gasto S/ ${r.spend.toFixed(2)} en los últimos 7 días${fallas}` };
}

/** Desconecta todas las cuentas publicitarias (deja de sincronizar). El Pixel y el historial se conservan. */
export async function disconnectMeta(): Promise<ActionResult> {
  const { store } = await requireOwner();
  const admin = createAdminClient();
  const { error } = await admin
    .from("store_meta_settings")
    .update({ ad_account_id: null, ad_account_name: null, ad_account_currency: null, connected_at: null, sync_enabled: false })
    .eq("store_id", store.id);
  if (error) return { ok: false, error: "No se pudo desconectar" };
  await admin.from("store_meta_accounts").delete().eq("store_id", store.id);
  revalidatePath("/dashboard/marketing");
  return { ok: true, message: "Cuenta publicitaria desconectada. Tus datos anteriores se conservan." };
}
