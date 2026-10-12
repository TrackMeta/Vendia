"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createTemplate, TEMPLATES, type TemplateKey } from "@/modules/landing/defaults";
import { landingCacheTag } from "@/modules/landing/public-data";
import { type LandingContent, landingContent, type PageBlock } from "@/modules/landing/schema";

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2, "El enlace debe tener al menos 2 caracteres")
  .max(80)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "El enlace solo puede tener letras minúsculas, números y guiones");

const createSchema = z.object({
  product_id: z.uuid("Elige un producto"),
  title: z.string().trim().min(1, "Ponle un título").max(160),
  slug: slugSchema,
  template: z.enum(Object.keys(TEMPLATES) as [TemplateKey, ...TemplateKey[]]).default("clasica"),
});

export async function createLanding(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  const { store } = await requireOwner();
  const parsed = createSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const { data: images } = await supabase
    .from("product_images")
    .select("storage_path, is_primary, position")
    .eq("product_id", parsed.data.product_id)
    .eq("store_id", store.id)
    .order("position");

  const { template, ...fields } = parsed.data;
  const content = createTemplate(template, (images ?? []).map((i) => i.storage_path));
  const { data, error } = await supabase
    .from("landing_pages")
    .insert({ ...fields, store_id: store.id, content })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") return { ok: false, error: "Ya tienes una landing con ese enlace" };
    if (error.code === "23503") return { ok: false, error: "Producto no válido" };
    return { ok: false, error: "No se pudo crear la landing" };
  }
  revalidatePath("/dashboard/landings");
  redirect(`/dashboard/landings/${data.id}`);
}

/** Verifica que todas las imágenes de la landing pertenezcan a la tienda. */
function collectImagePaths(content: LandingContent): string[] {
  const paths: string[] = [];
  for (const b of content.page_blocks) {
    if (b.type === "image" || b.type === "image_text") paths.push(b.src);
    if (b.type === "carousel") paths.push(...b.images.map((i) => i.src));
    if (b.type === "testimonials") paths.push(...b.items.map((i) => i.avatar));
  }
  for (const b of content.form_blocks) {
    if (b.type === "form_image") paths.push(b.src);
    if (b.type === "form_bumps") paths.push(...b.items.map((i) => i.image));
  }
  paths.push(content.thank_you_upsell.image);
  return paths.filter(Boolean);
}

/** Productos usados en adicionales y en la oferta de gracias (deben ser de la tienda). */
function collectProductIds(content: LandingContent): string[] {
  const ids: string[] = [];
  for (const b of content.form_blocks) if (b.type === "form_bumps") ids.push(...b.items.map((i) => i.productId));
  if (content.thank_you_upsell.enabled) ids.push(content.thank_you_upsell.productId);
  return [...new Set(ids.filter(Boolean))];
}

/** Ángulo creativo, prueba A/B de landings y prueba de precio (se guardan en landing_pages.settings: valen sin publicar). */
const settingsSchema = z.object({
  angle: z.string().trim().max(60).default(""),
  ab: z
    .object({
      enabled: z.boolean(),
      variants: z.array(z.object({ landing_id: z.uuid(), weight: z.number().int().min(0).max(100) })).max(5),
    })
    .default({ enabled: false, variants: [] }),
  /** Prueba A/B de precio: precio B por oferta; la mitad de las visitas lo ve y se le cobra ese precio */
  price_test: z
    .object({
      enabled: z.boolean(),
      offers: z.record(z.uuid(), z.number().positive("El precio B debe ser mayor a 0").max(100_000)),
      started_at: z.string().max(40).nullable().default(null),
    })
    .default({ enabled: false, offers: {}, started_at: null }),
});
export type LandingSettings = z.infer<typeof settingsSchema>;

export async function saveLanding(
  landingId: string,
  input: { title: string; slug: string; product_id: string; content: unknown; settings?: unknown },
): Promise<ActionResult> {
  const { store } = await requireOwner();
  const meta = z.object({ title: z.string().trim().min(1).max(160), slug: slugSchema, product_id: z.uuid() }).safeParse(input);
  if (!meta.success) return { ok: false, error: meta.error.issues[0].message };
  const content = landingContent.safeParse(input.content);
  if (!content.success) return { ok: false, error: content.error.issues[0].message };
  if (collectImagePaths(content.data).some((p) => !p.startsWith(`${store.id}/`))) {
    return { ok: false, error: "Hay imágenes que no pertenecen a tu tienda" };
  }
  const settings = settingsSchema.safeParse(input.settings ?? {});
  if (!settings.success) return { ok: false, error: "Revisa el ángulo y la prueba A/B" };
  const ab = settings.data.ab;
  if (ab.enabled) {
    if (ab.variants.length < 2) return { ok: false, error: "La prueba A/B necesita al menos 2 landings" };
    if (!ab.variants.some((v) => v.landing_id === landingId)) return { ok: false, error: "Incluye esta landing en la prueba A/B" };
    if (ab.variants.reduce((s, v) => s + v.weight, 0) <= 0) return { ok: false, error: "Reparte el tráfico de la prueba A/B (los porcentajes suman 0)" };
  }

  const supabase = await createClient();
  const productIds = collectProductIds(content.data);
  if (productIds.length) {
    const { data: own } = await supabase.from("products").select("id").eq("store_id", store.id).in("id", productIds);
    if ((own ?? []).length !== productIds.length) return { ok: false, error: "Hay productos adicionales que no son de tu tienda" };
  }
  // Prueba de precio: solo ofertas del producto de esta landing, y al menos un precio B
  const priceTest = settings.data.price_test;
  if (priceTest.enabled) {
    const offerIds = Object.keys(priceTest.offers);
    if (!offerIds.length) return { ok: false, error: "Pon el precio B de al menos una oferta para la prueba de precio" };
    const { data: own } = await supabase.from("product_offers").select("id").eq("store_id", store.id).eq("product_id", meta.data.product_id).in("id", offerIds);
    if ((own ?? []).length !== offerIds.length) return { ok: false, error: "La prueba de precio tiene ofertas de otro producto" };
    if (!priceTest.started_at) priceTest.started_at = new Date().toISOString();
  }
  const variantIds = ab.variants.map((v) => v.landing_id);
  if (variantIds.length) {
    const { data: own } = await supabase.from("landing_pages").select("id").eq("store_id", store.id).in("id", variantIds);
    if ((own ?? []).length !== new Set(variantIds).size) return { ok: false, error: "Hay landings de la prueba A/B que no son de tu tienda" };
  }
  const { error } = await supabase
    .from("landing_pages")
    .update({ ...meta.data, content: content.data, settings: settings.data })
    .eq("id", landingId)
    .eq("store_id", store.id);
  if (error) {
    if (error.code === "23505") return { ok: false, error: "Ya tienes otra landing con ese enlace" };
    return { ok: false, error: "No se pudo guardar" };
  }
  revalidatePath("/dashboard/landings");
  // Los ajustes (A/B, precio) valen al instante en la landing publicada
  revalidateTag(landingCacheTag(store.slug, meta.data.slug), { expire: 0 });
  return { ok: true, message: "Borrador guardado" };
}

export async function publishLanding(landingId: string): Promise<ActionResult> {
  const { store } = await requireOwner();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("publish_landing_page", { p_landing_id: landingId });
  if (error) return { ok: false, error: error.code === "P0001" ? error.message : "No se pudo publicar" };
  revalidateTag(landingCacheTag(store.slug, (data as { slug: string }).slug), { expire: 0 });
  revalidatePath("/dashboard/landings");
  return { ok: true, message: "¡Landing publicada!" };
}

export async function unpublishLanding(landingId: string): Promise<ActionResult> {
  const { store } = await requireOwner();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("unpublish_landing_page", { p_landing_id: landingId });
  if (error) return { ok: false, error: "No se pudo despublicar" };
  revalidateTag(landingCacheTag(store.slug, (data as { slug: string }).slug), { expire: 0 });
  revalidatePath("/dashboard/landings");
  return { ok: true, message: "Landing despublicada" };
}

export async function duplicateLanding(landingId: string): Promise<ActionResult> {
  const { store } = await requireOwner();
  const supabase = await createClient();
  const { data: source } = await supabase
    .from("landing_pages")
    .select("product_id, title, slug, content, settings")
    .eq("id", landingId)
    .eq("store_id", store.id)
    .single();
  if (!source) return { ok: false, error: "Landing no encontrada" };

  const slug = `${source.slug}-copia-${Math.random().toString(36).slice(2, 6)}`.slice(0, 80);
  const { data, error } = await supabase
    .from("landing_pages")
    .insert({
      store_id: store.id,
      product_id: source.product_id,
      title: `${source.title} (copia)`,
      slug,
      content: source.content,
      // La copia hereda el ángulo, no la prueba A/B
      settings: { angle: (source.settings as { angle?: string } | null)?.angle ?? "" },
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: "No se pudo duplicar" };
  revalidatePath("/dashboard/landings");
  redirect(`/dashboard/landings/${data.id}`);
}

export async function deleteLanding(landingId: string): Promise<ActionResult> {
  const { store } = await requireOwner();
  const supabase = await createClient();
  const { data } = await supabase.from("landing_pages").select("slug").eq("id", landingId).eq("store_id", store.id).single();
  const { error } = await supabase.from("landing_pages").delete().eq("id", landingId).eq("store_id", store.id);
  if (error) return { ok: false, error: "No se pudo eliminar" };
  if (data) revalidateTag(landingCacheTag(store.slug, data.slug), { expire: 0 });
  revalidatePath("/dashboard/landings");
  redirect("/dashboard/landings");
}

/** Bloques de otra landing de la tienda (para copiarlos). */
export async function getLandingBlocks(landingId: string): Promise<{ ok: true; blocks: PageBlock[] } | { ok: false; error: string }> {
  const { store } = await requireOwner();
  if (!z.uuid().safeParse(landingId).success) return { ok: false, error: "Landing inválida" };
  const supabase = await createClient();
  const { data } = await supabase.from("landing_pages").select("content").eq("id", landingId).eq("store_id", store.id).maybeSingle();
  const parsed = landingContent.safeParse(data?.content);
  if (!parsed.success) return { ok: false, error: "No se pudo leer esa landing" };
  return { ok: true, blocks: parsed.data.page_blocks };
}


export type PriceTestRow = {
  variant: "A" | "B";
  visits: number;
  form_opens: number;
  orders: number;
  orders_value: number;
  confirmed: number;
  delivered: number;
  revenue: number;
  product_cost: number;
  shipping_cost: number;
};

/** Resultados de la prueba de precio desde que empezó. */
export async function getPriceTestResults(landingId: string): Promise<{ ok: true; rows: PriceTestRow[]; since: string | null } | { ok: false; error: string }> {
  await requireOwner();
  if (!z.uuid().safeParse(landingId).success) return { ok: false, error: "Landing inválida" };
  const supabase = await createClient();
  const { data: landing } = await supabase.from("landing_pages").select("settings").eq("id", landingId).maybeSingle();
  const since = ((landing?.settings as { price_test?: { started_at?: string | null } } | null)?.price_test?.started_at ?? null) as string | null;
  const { data, error } = await supabase.rpc("get_price_test", { p_landing_id: landingId, p_since: since ?? new Date(0).toISOString() });
  if (error) return { ok: false, error: "No se pudieron leer los resultados (¿corriste el SQL del Bloque 13?)" };
  const rows = ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    variant: r.variant as "A" | "B",
    visits: Number(r.visits),
    form_opens: Number(r.form_opens),
    orders: Number(r.orders),
    orders_value: Number(r.orders_value),
    confirmed: Number(r.confirmed),
    delivered: Number(r.delivered),
    revenue: Number(r.revenue),
    product_cost: Number(r.product_cost),
    shipping_cost: Number(r.shipping_cost),
  }));
  return { ok: true, rows, since };
}

/**
 * Termina la prueba de precio. «B» pasa los precios B a las ofertas del producto (valen para todas
 * sus landings); «A» deja los precios como estaban.
 */
export async function finishPriceTest(landingId: string, keep: "A" | "B"): Promise<ActionResult> {
  const { store } = await requireOwner();
  if (!z.uuid().safeParse(landingId).success) return { ok: false, error: "Landing inválida" };
  const supabase = await createClient();
  const { data: landing } = await supabase.from("landing_pages").select("slug, product_id, settings").eq("id", landingId).eq("store_id", store.id).maybeSingle();
  if (!landing) return { ok: false, error: "Landing no encontrada" };
  const settings = (landing.settings ?? {}) as Record<string, unknown> & { price_test?: { offers?: Record<string, number> } };
  if (keep === "B") {
    for (const [offerId, price] of Object.entries(settings.price_test?.offers ?? {})) {
      if (!(Number(price) > 0)) continue;
      const { error } = await supabase.from("product_offers").update({ price: Number(price) }).eq("id", offerId).eq("store_id", store.id).eq("product_id", landing.product_id);
      if (error) return { ok: false, error: "No se pudieron actualizar los precios de las ofertas" };
    }
  }
  const { error } = await supabase
    .from("landing_pages")
    .update({ settings: { ...settings, price_test: { enabled: false, offers: {}, started_at: null } } })
    .eq("id", landingId)
    .eq("store_id", store.id);
  if (error) return { ok: false, error: "No se pudo terminar la prueba" };
  revalidateTag(landingCacheTag(store.slug, landing.slug), { expire: 0 });
  revalidatePath(`/dashboard/landings/${landingId}`);
  revalidatePath("/dashboard/productos");
  return { ok: true, message: keep === "B" ? "Listo: tus ofertas ya tienen el precio B" : "Prueba terminada: se quedan los precios de siempre" };
}
