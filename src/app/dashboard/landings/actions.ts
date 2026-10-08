"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireStore } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createClassicTemplate } from "@/modules/landing/defaults";
import { landingCacheTag } from "@/modules/landing/public-data";
import { type LandingContent, landingContent } from "@/modules/landing/schema";

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
});

export async function createLanding(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  const { store } = await requireStore();
  const parsed = createSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const { data: images } = await supabase
    .from("product_images")
    .select("storage_path, is_primary, position")
    .eq("product_id", parsed.data.product_id)
    .eq("store_id", store.id)
    .order("position");

  const content = createClassicTemplate((images ?? []).map((i) => i.storage_path));
  const { data, error } = await supabase
    .from("landing_pages")
    .insert({ ...parsed.data, store_id: store.id, content })
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
  for (const b of content.form_blocks) if (b.type === "form_image") paths.push(b.src);
  return paths.filter(Boolean);
}

export async function saveLanding(
  landingId: string,
  input: { title: string; slug: string; product_id: string; content: unknown },
): Promise<ActionResult> {
  const { store } = await requireStore();
  const meta = z.object({ title: z.string().trim().min(1).max(160), slug: slugSchema, product_id: z.uuid() }).safeParse(input);
  if (!meta.success) return { ok: false, error: meta.error.issues[0].message };
  const content = landingContent.safeParse(input.content);
  if (!content.success) return { ok: false, error: content.error.issues[0].message };
  if (collectImagePaths(content.data).some((p) => !p.startsWith(`${store.id}/`))) {
    return { ok: false, error: "Hay imágenes que no pertenecen a tu tienda" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("landing_pages")
    .update({ ...meta.data, content: content.data })
    .eq("id", landingId)
    .eq("store_id", store.id);
  if (error) {
    if (error.code === "23505") return { ok: false, error: "Ya tienes otra landing con ese enlace" };
    return { ok: false, error: "No se pudo guardar" };
  }
  revalidatePath("/dashboard/landings");
  return { ok: true, message: "Borrador guardado" };
}

export async function publishLanding(landingId: string): Promise<ActionResult> {
  const { store } = await requireStore();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("publish_landing_page", { p_landing_id: landingId });
  if (error) return { ok: false, error: error.code === "P0001" ? error.message : "No se pudo publicar" };
  revalidateTag(landingCacheTag(store.slug, (data as { slug: string }).slug), { expire: 0 });
  revalidatePath("/dashboard/landings");
  return { ok: true, message: "¡Landing publicada!" };
}

export async function unpublishLanding(landingId: string): Promise<ActionResult> {
  const { store } = await requireStore();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("unpublish_landing_page", { p_landing_id: landingId });
  if (error) return { ok: false, error: "No se pudo despublicar" };
  revalidateTag(landingCacheTag(store.slug, (data as { slug: string }).slug), { expire: 0 });
  revalidatePath("/dashboard/landings");
  return { ok: true, message: "Landing despublicada" };
}

export async function duplicateLanding(landingId: string): Promise<ActionResult> {
  const { store } = await requireStore();
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
    .insert({ store_id: store.id, product_id: source.product_id, title: `${source.title} (copia)`, slug, content: source.content, settings: source.settings })
    .select("id")
    .single();
  if (error) return { ok: false, error: "No se pudo duplicar" };
  revalidatePath("/dashboard/landings");
  redirect(`/dashboard/landings/${data.id}`);
}

export async function deleteLanding(landingId: string): Promise<ActionResult> {
  const { store } = await requireStore();
  const supabase = await createClient();
  const { data } = await supabase.from("landing_pages").select("slug").eq("id", landingId).eq("store_id", store.id).single();
  const { error } = await supabase.from("landing_pages").delete().eq("id", landingId).eq("store_id", store.id);
  if (error) return { ok: false, error: "No se pudo eliminar" };
  if (data) revalidateTag(landingCacheTag(store.slug, data.slug), { expire: 0 });
  revalidatePath("/dashboard/landings");
  redirect("/dashboard/landings");
}
