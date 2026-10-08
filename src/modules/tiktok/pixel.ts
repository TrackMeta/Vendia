"use client";

/**
 * TikTok Pixel en el navegador. Solo se carga si la tienda activó TikTok con su Pixel code.
 * Eventos: ViewContent, ClickButton (abre el formulario) y SubmitForm (pedido, con event_id para deduplicar
 * con Events API). CompletePayment (venta real) lo envía solo el servidor.
 */

type Ttq = {
  load: (code: string) => void;
  page: () => void;
  track: (event: string, params?: Record<string, unknown>, options?: { event_id?: string }) => void;
  [key: string]: unknown;
};

declare global {
  interface Window {
    ttq?: Ttq;
    TiktokAnalyticsObject?: string;
  }
}

let initialized: string | null = null;

export function initTikTok(pixelCode: string) {
  if (typeof window === "undefined" || !/^[A-Z0-9]{10,40}$/.test(pixelCode) || initialized === pixelCode) return;
  if (!window.ttq) {
    // Cola mínima: guarda las llamadas hasta que cargue el script oficial
    const queue: unknown[][] = [];
    const stub = new Proxy({} as Ttq, {
      get: (_t, prop: string) =>
        prop === "_q" ? queue : (...args: unknown[]) => {
          queue.push([prop, ...args]);
        },
    });
    window.TiktokAnalyticsObject = "ttq";
    window.ttq = stub;
    const script = document.createElement("script");
    script.async = true;
    script.src = `https://analytics.tiktok.com/i18n/pixel/events.js?sdkid=${pixelCode}&lib=ttq`;
    script.onload = () => {
      const real = window.ttq;
      if (real && real !== stub) for (const [method, ...args] of queue) (real[method as string] as (...a: unknown[]) => void)?.(...args);
    };
    document.head.appendChild(script);
  }
  window.ttq?.load(pixelCode);
  window.ttq?.page();
  initialized = pixelCode;
}

export function trackTikTok(event: "ViewContent" | "ClickButton" | "SubmitForm", params?: Record<string, unknown>, eventId?: string) {
  if (typeof window === "undefined" || !window.ttq || !initialized) return;
  window.ttq.track(event, params ?? {}, eventId ? { event_id: eventId } : undefined);
}
