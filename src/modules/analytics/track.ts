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

export function trackEvent(landingId: string, event: TrackEvent, extra: TrackExtra = {}) {
  const key = `${landingId}:${event}`;
  if (sent.has(key)) return;
  sent.add(key);
  const attribution = readAttribution();
  const body = JSON.stringify({
    landing_id: landingId,
    event,
    session_id: sessionId(),
    utm_source: attribution.utm_source,
    utm_campaign: attribution.utm_campaign,
    campaign_id: attribution.campaign_id,
    adset_id: attribution.adset_id,
    ad_id: attribution.ad_id,
    ...(extra.angle ? { angle: extra.angle } : {}),
    ...(extra.priceVariant ? { price_variant: extra.priceVariant } : {}),
  });
  try {
    if (navigator.sendBeacon) {
      navigator.sendBeacon("/api/track", new Blob([body], { type: "application/json" }));
      return;
    }
  } catch {}
  void fetch("/api/track", { method: "POST", body, headers: { "Content-Type": "application/json" }, keepalive: true }).catch(() => {});
}
