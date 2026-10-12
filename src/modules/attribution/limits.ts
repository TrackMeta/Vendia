/**
 * Largo máximo de cada dato de seguimiento (lo que guarda la base de datos).
 * Si llega algo más largo se recorta: nunca debe impedir que el cliente haga su pedido.
 */
export const ATTRIBUTION_LIMITS = {
  utm_source: 255,
  utm_medium: 255,
  utm_campaign: 255,
  utm_content: 255,
  utm_term: 255,
  fbclid: 512,
  fbc: 600,
  fbp: 255,
  ttclid: 500,
  ttp: 255,
  campaign_id: 64,
  adset_id: 64,
  ad_id: 64,
  referrer: 1000,
  landing_url: 2000,
} as const;

export type AttributionKey = keyof typeof ATTRIBUTION_LIMITS;
