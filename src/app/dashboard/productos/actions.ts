"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireStore } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { offersInput, productInput } from "@/modules/products/schema";

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

function formToObject(formData: FormData) {
  return Object.fromEntries(formData.entries());
}

export async function createProduct(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  const { store } = await requireStore();
  const parsed = productInput.safeParse(formToObject(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .insert({ ...parsed.data, store_id: store.id })
    .select("id, price")
    .single();
  if (error) {
    if (error.code === "23505") return { ok: false, error: "Ya tienes un producto con ese SKU" };
    return { ok: false, error: "No se pudo crear el producto" };
  }

  // Oferta inicial "1 unidad" al precio del producto (se puede editar)
  await supabase.from("product_offers").insert({
    store_id: store.id,
    product_id: data.id,
    name: "1 unidad",
    quantity: 1,
    price: data.price,
    compare_at_price: parsed.data.compare_at_price,
    is_default: true,
    position: 0,
  });

  revalidatePath("/dashboard/productos");
  redirect(`/dashboard/productos/${data.id}?creado=1`);
}

export async function updateProduct(productId: string, _prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  const { store } = await requireStore();
  const parsed = productInput.safeParse(formToObject(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const { error } = await supabase.from("products").update(parsed.data).eq("id", productId).eq("store_id", store.id);
  if (error) {
    if (error.code === "23505") return { ok: false, error: "Ya tienes un producto con ese SKU" };
    return { ok: false, error: "No se pudo guardar" };
  }
  revalidatePath("/dashboard/productos");
  revalidatePath(`/dashboard/productos/${productId}`);
  return { ok: true, message: "Producto guardado" };
}

export async function deleteProduct(productId: string): Promise<ActionResult> {
  const { store } = await requireStore();
  const supabase = await createClient();
  const { error } = await supabase.from("products").delete().eq("id", productId).eq("store_id", store.id);
  if (error) {
    if (error.code === "23503") {
      return { ok: false, error: "Este producto tiene landings o pedidos. Archívalo en lugar de eliminarlo." };
    }
    return { ok: false, error: "No se pudo eliminar" };
  }
  revalidatePath("/dashboard/productos");
  redirect("/dashboard/productos");
}

export async function saveOffers(productId: string, offers: unknown): Promise<ActionResult> {
  const { store } = await requireStore();
  const parsed = offersInput.safeParse(offers);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const { data: existing } = await supabase.from("product_offers").select("id").eq("product_id", productId).eq("store_id", store.id);
  const keepIds = new Set(parsed.data.filter((o) => o.id).map((o) => o.id));
  const toDelete = (existing ?? []).map((o) => o.id).filter((id) => !keepIds.has(id));

  if (toDelete.length) {
    // Las ofertas usadas en pedidos se desactivan (el pedido guarda una copia del nombre y precio).
    const { error } = await supabase.from("product_offers").delete().in("id", toDelete).eq("store_id", store.id);
    if (error) return { ok: false, error: "No se pudieron eliminar ofertas" };
  }

  const rows = parsed.data.map((o, position) => ({
    ...(o.id ? { id: o.id } : {}),
    store_id: store.id,
    product_id: productId,
    name: o.name,
    quantity: o.quantity,
    price: o.price,
    compare_at_price: o.compare_at_price,
    badge: o.badge,
    image_path: o.image_path ?? null,
    is_default: o.is_default,
    is_active: o.is_active,
    position,
  }));

  if (rows.length) {
    const { error } = await supabase.from("product_offers").upsert(rows);
    if (error) return { ok: false, error: "No se pudieron guardar las ofertas" };
  }
  revalidatePath(`/dashboard/productos/${productId}`);
  return { ok: true, message: "Ofertas guardadas" };
}

const imageRow = z.object({ path: z.string().min(1).max(500), width: z.number().nullable(), height: z.number().nullable() });

export async function addProductImages(productId: string, images: unknown): Promise<ActionResult> {
  const { store } = await requireStore();
  const parsed = z.array(imageRow).max(20).safeParse(images);
  if (!parsed.success) return { ok: false, error: "Imágenes inválidas" };
  if (parsed.data.some((i) => !i.path.startsWith(`${store.id}/`))) return { ok: false, error: "Ruta de imagen inválida" };

  const supabase = await createClient();
  const { data: current } = await supabase
    .from("product_images")
    .select("id, position, is_primary")
    .eq("product_id", productId)
    .eq("store_id", store.id);
  const start = (current ?? []).reduce((max, i) => Math.max(max, i.position + 1), 0);
  const hasPrimary = (current ?? []).some((i) => i.is_primary);

  const { error } = await supabase.from("product_images").insert(
    parsed.data.map((img, i) => ({
      store_id: store.id,
      product_id: productId,
      storage_path: img.path,
      width: img.width,
      height: img.height,
      position: start + i,
      is_primary: !hasPrimary && i === 0,
    })),
  );
  if (error) return { ok: false, error: "No se pudieron guardar las imágenes" };
  revalidatePath(`/dashboard/productos/${productId}`);
  return { ok: true };
}

export async function deleteProductImage(productId: string, imageId: string): Promise<ActionResult> {
  const { store } = await requireStore();
  const supabase = await createClient();
  const { data: image } = await supabase
    .from("product_images")
    .select("storage_path, is_primary")
    .eq("id", imageId)
    .eq("store_id", store.id)
    .single();
  if (!image) return { ok: false, error: "Imagen no encontrada" };

  await supabase.from("product_images").delete().eq("id", imageId).eq("store_id", store.id);
  await supabase.storage.from("store-assets").remove([image.storage_path]);

  if (image.is_primary) {
    const { data: next } = await supabase
      .from("product_images")
      .select("id")
      .eq("product_id", productId)
      .order("position")
      .limit(1)
      .maybeSingle();
    if (next) await supabase.from("product_images").update({ is_primary: true }).eq("id", next.id);
  }
  revalidatePath(`/dashboard/productos/${productId}`);
  return { ok: true };
}

export async function reorderProductImages(productId: string, orderedIds: string[], primaryId: string | null): Promise<ActionResult> {
  const { store } = await requireStore();
  const ids = z.array(z.uuid()).max(50).safeParse(orderedIds);
  if (!ids.success) return { ok: false, error: "Orden inválido" };

  const supabase = await createClient();
  if (primaryId) {
    await supabase.from("product_images").update({ is_primary: false }).eq("product_id", productId).eq("store_id", store.id);
  }
  for (const [position, id] of ids.data.entries()) {
    await supabase
      .from("product_images")
      .update({ position, ...(primaryId ? { is_primary: id === primaryId } : {}) })
      .eq("id", id)
      .eq("store_id", store.id);
  }
  revalidatePath(`/dashboard/productos/${productId}`);
  return { ok: true };
}
