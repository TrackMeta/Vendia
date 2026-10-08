import "server-only";
import { createClient } from "@supabase/supabase-js";
import { unstable_cache } from "next/cache";
import { env } from "@/lib/env";
import type { LandingRenderData, PublicLanding } from "./types";

export function landingCacheTag(storeSlug: string, slug: string) {
  return `landing:${storeSlug}:${slug}`;
}

/** Cliente anónimo (sin cookies): solo puede llamar a get_public_landing. */
function anonClient() {
  return createClient(env.supabaseUrl(), env.supabasePublishableKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function getPublicLanding(storeSlug: string, slug: string): Promise<PublicLanding | null> {
  const cached = unstable_cache(
    async () => {
      const { data, error } = await anonClient().rpc("get_public_landing", { p_store_slug: storeSlug, p_slug: slug });
      if (error) throw new Error(`get_public_landing: ${error.message}`);
      return (data as PublicLanding | null) ?? null;
    },
    ["public-landing", storeSlug, slug],
    { tags: [landingCacheTag(storeSlug, slug)], revalidate: 300 },
  );
  return cached();
}

export function toRenderData(landing: PublicLanding): LandingRenderData {
  return {
    landingId: landing.landing.id,
    storeName: landing.store.name,
    storeSlug: landing.store.slug,
    landingSlug: landing.landing.slug,
    content: landing.landing.content,
    product: {
      name: landing.product.name,
      price: Number(landing.product.price),
      compare_at_price: landing.product.compare_at_price === null ? null : Number(landing.product.compare_at_price),
    },
    offers: landing.offers.map((o) => ({
      ...o,
      price: Number(o.price),
      compare_at_price: o.compare_at_price === null ? null : Number(o.compare_at_price),
    })),
    shipping: { lima: Number(landing.store.shipping_lima), province: Number(landing.store.shipping_province) },
    advanceAmount: Number(landing.store.advance_amount),
  };
}
