import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createClassicTemplate } from "@/modules/landing/defaults";
import { landingContent } from "@/modules/landing/schema";
import type { PublicOffer } from "@/modules/landing/types";
import { LandingBuilder } from "./builder";

export const metadata: Metadata = { title: "Editor de landing" };

/** Ajustes guardados (ángulo y prueba A/B) con valores por defecto. */
function landingSettings(raw: unknown) {
  const s = (raw ?? {}) as { angle?: string; ab?: { enabled?: boolean; variants?: { landing_id: string; weight: number }[] } };
  return { angle: s.angle ?? "", ab: { enabled: Boolean(s.ab?.enabled), variants: s.ab?.variants ?? [] } };
}

export default async function LandingEditorPage({ params }: PageProps<"/dashboard/landings/[id]">) {
  const { id } = await params;
  const { store } = await requireOwner();
  const supabase = await createClient();

  const [{ data: landing }, { data: products }, { data: offers }, { data: settings }, { data: images }, { data: others }] = await Promise.all([
    supabase
      .from("landing_pages")
      .select("id, title, slug, product_id, status, content, published_content, settings")
      .eq("id", id)
      .eq("store_id", store.id)
      .maybeSingle(),
    supabase.from("products").select("id, name, price, compare_at_price, description").eq("store_id", store.id).neq("status", "archived").order("name"),
    supabase
      .from("product_offers")
      .select("id, product_id, name, quantity, price, compare_at_price, badge, image_path, is_default")
      .eq("store_id", store.id)
      .eq("is_active", true)
      .order("position"),
    supabase.from("store_settings").select("shipping_lima, shipping_province, advance_amount, whatsapp").eq("store_id", store.id).single(),
    supabase.from("product_images").select("product_id, storage_path, is_primary, position").eq("store_id", store.id).order("position"),
    supabase.from("landing_pages").select("id, title, slug, status").eq("store_id", store.id).neq("id", id).order("updated_at", { ascending: false }),
  ]);
  if (!landing) notFound();

  const parsed = landingContent.safeParse(landing.content);
  const content = parsed.success ? parsed.data : createClassicTemplate();

  const offersByProduct: Record<string, PublicOffer[]> = {};
  for (const o of offers ?? []) {
    (offersByProduct[o.product_id] ??= []).push({
      id: o.id,
      name: o.name,
      quantity: o.quantity,
      price: Number(o.price),
      compare_at_price: o.compare_at_price === null ? null : Number(o.compare_at_price),
      badge: o.badge,
      image_path: o.image_path,
      is_default: o.is_default,
    });
  }

  return (
    <LandingBuilder
      landing={{
        id: landing.id,
        title: landing.title,
        slug: landing.slug,
        product_id: landing.product_id,
        status: landing.status as "draft" | "published",
        content,
        settings: landingSettings(landing.settings),
        hasUnpublishedChanges: JSON.stringify(landing.content) !== JSON.stringify(landing.published_content),
      }}
      storeId={store.id}
      storeSlug={store.slug}
      storeName={store.name}
      products={(products ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        price: Number(p.price),
        compare_at_price: p.compare_at_price === null ? null : Number(p.compare_at_price),
        description: p.description,
        images: (images ?? [])
          .filter((i) => i.product_id === p.id)
          .sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || a.position - b.position)
          .map((i) => i.storage_path),
      }))}
      otherLandings={others ?? []}
      storeWhatsapp={settings?.whatsapp ?? null}
      offersByProduct={offersByProduct}
      pricing={{
        shippingLima: Number(settings?.shipping_lima ?? 0),
        shippingProvince: Number(settings?.shipping_province ?? 0),
        advance: Number(settings?.advance_amount ?? 0),
      }}
    />
  );
}
