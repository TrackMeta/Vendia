"use client";

/**
 * Meta Pixel en el navegador. Solo se carga si la tienda configuró su Pixel ID.
 * Eventos: PageView, ViewContent, InitiateCheckout, Lead (con eventID para deduplicar con CAPI).
 * Purchase NO se envía desde el navegador: lo envía el servidor cuando el pedido es venta real.
 */

type Fbq = ((...args: unknown[]) => void) & { callMethod?: unknown; queue?: unknown[]; loaded?: boolean; version?: string; push?: unknown };

declare global {
  interface Window {
    fbq?: Fbq;
    _fbq?: Fbq;
  }
}

let initializedPixel: string | null = null;

export function initPixel(pixelId: string) {
  if (typeof window === "undefined" || !/^\d{5,20}$/.test(pixelId) || initializedPixel === pixelId) return;
  if (!window.fbq) {
    const fbq: Fbq = function (...args: unknown[]) {
      if (fbq.callMethod) (fbq.callMethod as (...a: unknown[]) => void)(...args);
      else fbq.queue!.push(args);
    } as Fbq;
    fbq.push = fbq;
    fbq.loaded = true;
    fbq.version = "2.0";
    fbq.queue = [];
    window.fbq = fbq;
    window._fbq = fbq;
    const script = document.createElement("script");
    script.async = true;
    script.src = "https://connect.facebook.net/en_US/fbevents.js";
    document.head.appendChild(script);
  }
  window.fbq("init", pixelId);
  initializedPixel = pixelId;
}

export function trackPixel(event: "PageView" | "ViewContent" | "InitiateCheckout" | "Lead", params?: Record<string, unknown>, eventId?: string) {
  if (typeof window === "undefined" || !window.fbq || !initializedPixel) return;
  if (eventId) window.fbq("track", event, params ?? {}, { eventID: eventId });
  else window.fbq("track", event, params ?? {});
}
