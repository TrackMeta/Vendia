"use client";

const sent = new Set<string>();

/** Envía un error del navegador a /api/errors (una vez por mensaje y página). */
export function reportClientError(error: unknown, extra: { digest?: string } = {}) {
  try {
    const e = error instanceof Error ? error : new Error(String(error));
    const key = `${e.message}|${location.pathname}`;
    if (sent.has(key) || sent.size > 20) return;
    sent.add(key);
    const body = JSON.stringify({
      message: e.message.slice(0, 1000) || "Error sin mensaje",
      stack: e.stack?.slice(0, 6000),
      path: location.pathname.slice(0, 500),
      digest: extra.digest,
    });
    if (navigator.sendBeacon) navigator.sendBeacon("/api/errors", new Blob([body], { type: "application/json" }));
    else void fetch("/api/errors", { method: "POST", body, headers: { "Content-Type": "application/json" }, keepalive: true });
  } catch {
    // nunca romper la página por reportar
  }
}
