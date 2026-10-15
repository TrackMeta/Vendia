"use client";

import { readAttribution } from "@/modules/attribution/capture";

/** Seguimiento propio (funnel): visitas únicas por sesión, no depende de Meta. */

export type TrackEvent =
  | "page_view"
  | "view_content"
  | "initiate_checkout"
  // Pasos dentro del formulario (embudo del formulario)
  | "form_name"
  | "form_phone"
  | "form_location"
  | "form_address"
  | "form_submit";

/** Datos extra de la visita: ángulo y versión de la prueba de precio. */
export type TrackExtra = { angle?: string | null; priceVariant?: "A" | "B" | null };

const SESSION_KEY = "vd_sid";

export function sessionId(): string {
  try {
    let id = sessionStorage.getItem(SESSION_KEY);
    if (!id) {
      id = crypto.randomUUID().replace(/-/g, "");
      sessionStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    return `anon${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  }
}

const sent = new Set<string>();

// Los eventos se juntan y viajan en un solo pedido a Vercel (el plan cuenta cada pedido).
// La visita y el pedido enviado salen al toque; los pasos intermedios esperan unos segundos
// o hasta que el cliente cambia de app / cierra la página (lo que pase primero).
const BATCH_MS = 3000;
let queue: { landingId: string; event: TrackEvent; extra: TrackExtra }[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let listening = false;

export function trackEvent(landingId: string, event: TrackEvent, extra: TrackExtra = {}) {
  const key = `${landingId}:${event}`;
  if (sent.has(key)) return;
  sent.add(key);
  queue.push({ landingId, event, extra });
  if (event === "page_view" || event === "form_submit") {
    flush();
    return;
  }
  if (!listening) {
    listening = true;
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flush();
    });
    window.addEventListener("pagehide", flush);
  }
  timer ??= setTimeout(flush, BATCH_MS);
}

function flush() {
  if (timer) clearTimeout(timer);
  timer = null;
  if (!queue.length) return;
  const pending = queue;
  queue = [];
  for (const landingId of new Set(pending.map((q) => q.landingId))) {
    const items = pending.filter((q) => q.landingId === landingId);
    const extra = items[0].extra;
    send({
      landing_id: landingId,
      events: items.map((q) => q.event),
      ...(extra.angle ? { angle: extra.angle } : {}),
      ...(extra.priceVariant ? { price_variant: extra.priceVariant } : {}),
    });
  }
}

function send(payload: Record<string, unknown>) {
  const attribution = readAttribution();
  const body = JSON.stringify({
    ...payload,
    session_id: sessionId(),
    utm_source: attribution.utm_source,
    utm_campaign: attribution.utm_campaign,
    campaign_id: attribution.campaign_id,
    adset_id: attribution.adset_id,
    ad_id: attribution.ad_id,
  });
  try {
    if (navigator.sendBeacon) {
      navigator.sendBeacon("/api/track", new Blob([body], { type: "application/json" }));
      return;
    }
  } catch {}
  void fetch("/api/track", { method: "POST", body, headers: { "Content-Type": "application/json" }, keepalive: true }).catch(() => {});
}
