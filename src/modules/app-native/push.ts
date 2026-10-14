import { createClient } from "@/lib/supabase/client";
import { readSoundPrefs } from "@/modules/notifications/sound";
import { PUSH_CHANNELS } from "@/modules/push/channels";
import { getPushState, nativePlugin, readMutedStores, setPushState, vendiaNativo } from "./client";

type Permission = { receive: "prompt" | "prompt-with-rationale" | "granted" | "denied" };
type PushData = { link?: string; store_id?: string };
type PushPlugin = {
  createChannel: (c: Record<string, unknown>) => Promise<void>;
  checkPermissions: () => Promise<Permission>;
  requestPermissions: () => Promise<Permission>;
  register: () => Promise<void>;
  removeAllListeners: () => Promise<void>;
  addListener: (event: string, cb: (data: never) => void) => Promise<unknown>;
};

let registering = false;
let syncTimer: ReturnType<typeof setTimeout> | null = null;

/** Modelo del celular, para reconocerlo en la lista (solo lo que dice el navegador). */
function deviceModel(): string | null {
  const m = navigator.userAgent.match(/Android [\d.]+; ([^;)]+)/);
  return m ? m[1].trim().slice(0, 120) : null;
}

/** Guarda en Vendia este celular con su sonido y las tiendas silenciadas. */
async function syncDevice() {
  const { token, version } = getPushState();
  if (!token) return;
  const prefs = readSoundPrefs();
  const { error } = await createClient().rpc("register_push_device", {
    p_token: token,
    p_model: deviceModel(),
    p_app_version: version,
    p_sound: prefs.sound,
    p_sound_enabled: prefs.enabled,
    p_only_orders: prefs.onlyOrders,
    p_muted_store_ids: readMutedStores(),
  });
  if (error) console.warn("[avisos] no se guardó el celular", error.message);
}

/** Cambió el sonido o las tiendas: se vuelve a guardar (una sola vez aunque cambien varias cosas). */
export function scheduleDeviceSync() {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => void syncDevice(), 600);
}

/** Tocar un aviso: cambia a su tienda (si es otra) y abre el pedido. */
function openFromPush(data: PushData) {
  const link = typeof data.link === "string" && data.link.startsWith("/") ? data.link : "/dashboard/notificaciones";
  window.location.href = data.store_id ? `/dashboard/ir?tienda=${encodeURIComponent(data.store_id)}&a=${encodeURIComponent(link)}` : link;
}

/** Activa los avisos con la app cerrada en este celular (una vez por sesión; «force» = «Intentar de nuevo»). */
export async function registerPush(force = false) {
  const state = getPushState().status;
  if (registering || state === "ready" || (!force && (state === "denied" || state === "no-firebase" || state === "error"))) return;
  const PN = nativePlugin<PushPlugin>("PushNotifications");
  const native = vendiaNativo();
  if (!PN || !native) return setPushState({ status: "no-firebase" });
  registering = true;
  setPushState({ status: "starting" });
  try {
    const info = await native.info();
    setPushState({ version: info?.version ?? null });
    // Sin Firebase en la app, registrar cerraría la app: se espera a la versión con Firebase
    if (!info?.firebase) return setPushState({ status: "no-firebase" });

    // Un canal por sonido (Android toca el sonido del canal aunque la app esté cerrada)
    for (const ch of PUSH_CHANNELS) {
      await PN.createChannel({
        id: ch.id,
        name: ch.name,
        description: ch.sound ? "Avisos de Vendia con este sonido" : "Avisos de Vendia sin sonido",
        importance: ch.sound ? 5 : 2,
        visibility: 1,
        vibration: Boolean(ch.sound),
        lights: true,
        lightColor: "#E53935",
        sound: ch.sound ?? undefined, // res/raw/<sonido>.wav
      }).catch(() => {});
    }

    let perm = await PN.checkPermissions();
    if (perm.receive === "prompt" || perm.receive === "prompt-with-rationale") perm = await PN.requestPermissions();
    if (perm.receive !== "granted") return setPushState({ status: "denied" });

    await PN.removeAllListeners();
    await PN.addListener("registration", ((t: { value: string }) => {
      setPushState({ token: t.value, status: "ready" });
      void syncDevice();
    }) as (d: never) => void);
    await PN.addListener("registrationError", (() => setPushState({ status: "error" })) as (d: never) => void);
    await PN.addListener("pushNotificationActionPerformed", ((a: { notification?: { data?: PushData } }) => openFromPush(a.notification?.data ?? {})) as (d: never) => void);
    await PN.register();
  } catch (e) {
    console.warn("[avisos]", e);
    setPushState({ status: "error" });
  } finally {
    registering = false;
  }
}

/** Al cerrar sesión: este celular deja de recibir avisos de esta cuenta. */
export async function forgetPushDevice() {
  const { token } = getPushState();
  if (!token) return;
  try {
    await createClient().from("push_devices").delete().eq("token", token);
  } catch {}
  setPushState({ status: "starting", token: null });
}
