import type { MetaUserData } from "./user-data";

/** Versión de la Graph API para Conversions API (verificada en developers.facebook.com, 2026-10). */
export const META_GRAPH_VERSION = "v26.0";

/** Meta rechaza eventos con event_time de más de 7 días. */
export const META_MAX_EVENT_AGE_SECONDS = 7 * 24 * 3600;

export type MetaEventName = "PageView" | "ViewContent" | "InitiateCheckout" | "Lead" | "Purchase";

/** IDs estables: el MISMO id en Pixel (eventID) y en CAPI (event_id) → Meta deduplica. */
export const leadEventId = (orderId: string) => `lead_${orderId}`;
export const purchaseEventId = (orderId: string) => `purchase_${orderId}`;

export type ServerEvent = {
  event_name: MetaEventName;
  event_time: number;
  event_id: string;
  action_source: "website";
  event_source_url?: string;
  user_data: MetaUserData;
  custom_data?: {
    currency: "PEN";
    value?: number;
    content_ids?: string[];
    content_type?: "product";
    content_name?: string;
    num_items?: number;
    order_id?: string;
  };
};

export function buildServerEvent(input: {
  eventName: MetaEventName;
  eventId: string;
  eventTime: Date;
  sourceUrl?: string | null;
  userData: MetaUserData;
  value?: number;
  productId?: string | null;
  productName?: string | null;
  quantity?: number;
  orderNumber?: number;
}): ServerEvent {
  const event: ServerEvent = {
    event_name: input.eventName,
    event_time: Math.floor(input.eventTime.getTime() / 1000),
    event_id: input.eventId,
    // El pedido nació en la landing (web). Ver docs/PLAN.md §1.2.
    action_source: "website",
    user_data: input.userData,
    custom_data: {
      currency: "PEN",
      value: input.value !== undefined ? Math.round(input.value * 100) / 100 : undefined,
      content_ids: input.productId ? [input.productId] : undefined,
      content_type: input.productId ? "product" : undefined,
      content_name: input.productName ?? undefined,
      num_items: input.quantity,
      order_id: input.orderNumber !== undefined ? String(input.orderNumber) : undefined,
    },
  };
  if (input.sourceUrl) event.event_source_url = input.sourceUrl.slice(0, 1000);
  if (event.custom_data) {
    event.custom_data = Object.fromEntries(Object.entries(event.custom_data).filter(([, v]) => v !== undefined)) as ServerEvent["custom_data"];
  }
  return event;
}

export function isTooOld(eventTimeSeconds: number, nowMs = Date.now()): boolean {
  return nowMs / 1000 - eventTimeSeconds > META_MAX_EVENT_AGE_SECONDS - 3600;
}
