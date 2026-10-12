import "server-only";
import { revalidateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { landingCacheTag } from "./public-data";

/**
 * Refresca la caché pública de todas las landings (publicadas o no) que venden este producto.
 * La landing pública incluye precio, estado, fotos, variantes y ofertas del producto.
 */
export async function revalidateProductLandings(storeId: string, storeSlug: string, productId: string) {
  const supabase = await createClient();
  const { data } = await supabase.from("landing_pages").select("slug").eq("store_id", storeId).eq("product_id", productId);
  for (const l of data ?? []) revalidateTag(landingCacheTag(storeSlug, l.slug), { expire: 0 });
}
