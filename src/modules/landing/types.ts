import type { LandingContent } from "./schema";

/** Lo que devuelve public.get_public_landing() — solo datos públicos. */
export type PublicLanding = {
  landing: {
    id: string;
    slug: string;
    title: string;
    content: LandingContent;
    settings: { angle?: string | null };
    published_at: string | null;
    /** Variantes de la prueba A/B (solo si está activa) */
    ab_variants?: { slug: string; weight: number }[] | null;
  };
  store: {
    id: string;
    slug: string;
    name: string;
    currency: string;
    whatsapp: string | null;
    logo_path: string | null;
    favicon_path: string | null;
    shipping_lima: number;
    shipping_province: number;
    advance_amount: number;
    payment_methods: string[];
    confirmation_message: string;
  };
  product: {
    id: string;
    name: string;
    description: string | null;
    price: number;
    compare_at_price: number | null;
    images: { path: string; width: number | null; height: number | null }[];
  };
  offers: PublicOffer[];
  meta?: { pixel_id: string | null };
};

export type PublicOffer = {
  id: string;
  name: string;
  quantity: number;
  price: number;
  compare_at_price: number | null;
  badge: string | null;
  image_path: string | null;
  is_default: boolean;
};

/** Datos mínimos que el renderer necesita (sirve para la landing pública y la vista previa del editor). */
export type LandingRenderData = {
  landingId: string | null;
  /** Meta Pixel ID de la tienda (solo en la landing pública) */
  pixelId?: string | null;
  productId?: string | null;
  storeName: string;
  storeSlug: string;
  landingSlug: string;
  content: LandingContent;
  product: { name: string; price: number; compare_at_price: number | null; description?: string | null; images?: string[] };
  offers: PublicOffer[];
  /** WhatsApp de la tienda (botón flotante) */
  whatsapp?: string | null;
  shipping: { lima: number; province: number };
  advanceAmount: number;
};

/** Provincias con tarifa de envío "Lima": Lima Metropolitana y Callao. */
export const LIMA_SHIPPING_PROVINCES = ["1501", "0701"];

export function shippingFor(provinceCode: string | null, shipping: { lima: number; province: number }): number | null {
  if (!provinceCode) return null;
  return LIMA_SHIPPING_PROVINCES.includes(provinceCode) ? shipping.lima : shipping.province;
}
