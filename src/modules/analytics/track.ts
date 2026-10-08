"use client";

import { readAttribution } from "@/modules/attribution/capture";

/** Seguimiento propio (funnel): visitas únicas por sesión, no depende de Meta. */

export type TrackEvent = "page_view" | "view_content" | "initiate_checkout";

const SESSION_KEY = "vd_sid";

function sessionId(): string {
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

export function trackEvent(landingId: string, event: TrackEvent) {
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
  });
  try {
    if (navigator.sendBeacon) {
      navigator.sendBeacon("/api/track", new Blob([body], { type: "application/json" }));
      return;
    }
  } catch {}
  void fetch("/api/track", { method: "POST", body, headers: { "Content-Type": "application/json" }, keepalive: true }).catch(() => {});
}
