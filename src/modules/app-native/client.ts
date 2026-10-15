/**
 * Puente con la app de celular de Vendia (Android, Capacitor). La app abre esta misma web;
 * dentro de ella existe window.Capacitor con los plugins nativos. En el navegador todo esto no hace nada.
 */

type Listener = { remove: () => Promise<void> | void };
type AnyPlugin = Record<string, ((...args: never[]) => Promise<unknown>) | undefined> & {
  addListener?: (event: string, cb: (data: never) => void) => Promise<Listener> | Listener;
};

type CapacitorGlobal = { isNativePlatform?: () => boolean; Plugins?: Record<string, AnyPlugin | undefined> };

function cap(): CapacitorGlobal | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
}

/** ¿Esta página se está viendo dentro de la app de celular? */
export function isNativeApp(): boolean {
  try {
    return Boolean(cap()?.isNativePlatform?.());
  } catch {
    return false;
  }
}

/** Plugin nativo por nombre (VendiaNativo, PushNotifications, App, StatusBar). */
export function nativePlugin<T>(name: string): T | undefined {
  return cap()?.Plugins?.[name] as T | undefined;
}

export type VendiaNativo = {
  info: () => Promise<{ firebase: boolean; version: string; build: number }>;
  barras: (o: { color: string; claro: boolean }) => Promise<void>;
  abrirExterno: (o: { url: string }) => Promise<void>;
  guardarArchivo: (o: { base64: string; nombre: string; mime: string }) => Promise<{ ok: boolean; nombre: string }>;
  compartirArchivo: (o: { base64: string; nombre: string; mime: string }) => Promise<void>;
  imprimir: (o: { titulo: string }) => Promise<void>;
  /** La página ya se ve: cierra la pantalla de inicio animada (los APK anteriores no lo tienen). */
  listo?: () => Promise<void>;
};

export const vendiaNativo = () => nativePlugin<VendiaNativo>("VendiaNativo");

/** Esquemas que abre otra app del celular (llamadas, WhatsApp, mapas, correo). */
const EXTERNAL_SCHEMES = new Set(["tel:", "sms:", "mailto:", "whatsapp:", "geo:", "intent:", "market:"]);

/** Dirección que va afuera de la app (otra página, WhatsApp, llamada). Null si es de Vendia. */
export function externalUrl(href: string, current: string): string | null {
  let url: URL;
  try {
    url = new URL(href, current);
  } catch {
    return null;
  }
  if (EXTERNAL_SCHEMES.has(url.protocol)) return url.href;
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  return url.host === new URL(current).host ? null : url.href;
}

// ── Estado de los avisos en este celular (para la sección «Avisos en este celular») ──

export type PushStatus = "browser" | "starting" | "no-firebase" | "denied" | "ready" | "error";
export type PushState = { status: PushStatus; token: string | null; version: string | null };

let pushState: PushState = { status: "browser", token: null, version: null };
const listeners = new Set<() => void>();

export function getPushState(): PushState {
  return pushState;
}

export function setPushState(patch: Partial<PushState>) {
  pushState = { ...pushState, ...patch };
  listeners.forEach((l) => l());
}

export function subscribePushState(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

// ── Tiendas de las que este celular NO recibe avisos (lo elige cada persona en su celular) ──

export const PUSH_MUTED_KEY = "vd_push_muted";
export const PUSH_PREFS_EVENT = "vendia:push-prefs";

export function parseMutedStores(raw: string | null | undefined): string[] {
  try {
    const v = JSON.parse(raw ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 100) : [];
  } catch {
    return [];
  }
}

export function readMutedStores(): string[] {
  try {
    return parseMutedStores(localStorage.getItem(PUSH_MUTED_KEY));
  } catch {
    return [];
  }
}

export function saveMutedStores(ids: string[]) {
  try {
    localStorage.setItem(PUSH_MUTED_KEY, JSON.stringify([...new Set(ids)]));
  } catch {}
  window.dispatchEvent(new Event(PUSH_PREFS_EVENT));
}
