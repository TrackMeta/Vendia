import { createHash } from "node:crypto";

/** TikTok Events API v1.3 (https://business-api.tiktok.com/portal/docs?id=1771100865818625). */
export const TIKTOK_EVENTS_URL = "https://business-api.tiktok.com/open_api/v1.3/event/track/";

export type TikTokEventName = "SubmitForm" | "CompletePayment";

/** IDs estables: el MISMO id en el Pixel y en Events API → TikTok deduplica. */
export const submitEventId = (orderId: string) => `lead_${orderId}`;
export const paymentEventId = (orderId: string) => `purchase_${orderId}`;

const sha256 = (v: string) => createHash("sha256").update(v.trim().toLowerCase(), "utf8").digest("hex");

/** Teléfono en formato E.164 con «+» antes del hash, como pide TikTok. */
export function hashPhoneE164(phone: string): string | undefined {
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 8 ? sha256(`+${digits}`) : undefined;
}

export type TikTokEvent = {
  event: TikTokEventName;
  event_time: number;
  event_id: string;
  user: { phone?: string; external_id?: string; ttclid?: string; ttp?: string; ip?: string; user_agent?: string };
  properties: {
    currency: string;
    value: number;
    content_type: "product";
    contents?: { content_id: string; content_name?: string; quantity?: number }[];
    order_id?: string;
  };
  page?: { url?: string };
};

export function buildTikTokEvent(input: {
  event: TikTokEventName;
  eventId: string;
  eventTime: Date;
  phone: string;
  customerId?: string | null;
  ttclid?: string | null;
  ttp?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  value: number;
  currency?: string;
  productId?: string | null;
  productName?: string | null;
  quantity?: number;
  orderNumber?: number;
  url?: string | null;
}): TikTokEvent {
  const user: TikTokEvent["user"] = {
    phone: hashPhoneE164(input.phone),
    external_id: input.customerId ? sha256(input.customerId) : undefined,
    ttclid: input.ttclid ?? undefined,
    ttp: input.ttp ?? undefined,
    ip: input.ip ?? undefined,
    user_agent: input.userAgent ?? undefined,
  };
  return {
    event: input.event,
    event_time: Math.floor(input.eventTime.getTime() / 1000),
    event_id: input.eventId,
    user: Object.fromEntries(Object.entries(user).filter(([, v]) => v !== undefined)) as TikTokEvent["user"],
    properties: {
      currency: input.currency ?? "PEN",
      value: Math.round(input.value * 100) / 100,
      content_type: "product",
      contents: input.productId ? [{ content_id: input.productId, content_name: input.productName ?? undefined, quantity: input.quantity }] : undefined,
      order_id: input.orderNumber !== undefined ? String(input.orderNumber) : undefined,
    },
    page: input.url ? { url: input.url } : undefined,
  };
}

/** Plantilla de URL para anuncios de TikTok (macros de TikTok Ads). */
export const TIKTOK_URL_TEMPLATE =
  "utm_source=tiktok&utm_medium=paid&utm_campaign=__CAMPAIGN_NAME__&utm_content=__CID_NAME__&utm_term=__AID_NAME__&campaign_id=__CAMPAIGN_ID__&adset_id=__AID__&ad_id=__CID__";
