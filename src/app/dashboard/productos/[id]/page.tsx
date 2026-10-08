import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/dashboard/page-header";
import { buttonVariants } from "@/components/ui/button";
import { requireOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { updateProduct } from "../actions";
import { ProductForm, type ProductFormValues } from "../product-form";
import { DeleteProductButton } from "./delete-button";
import { ImagesManager } from "./images-manager";
import { OffersManager } from "./offers-manager";

export const metadata: Metadata = { title: "Editar producto" };

export default async function EditProductPage({ params }: PageProps<"/dashboard/productos/[id]">) {
  const { id } = await params;
  const { store } = await requireOwner();
  const supabase = await createClient();

  const [{ data: product }, { data: images }, { data: offers }] = await Promise.all([
    supabase.from("products").select("*").eq("id", id).eq("store_id", store.id).maybeSingle(),
    supabase.from("product_images").select("id, storage_path, is_primary, position").eq("product_id", id).order("position"),
    supabase
      .from("product_offers")
      .select("id, name, quantity, price, compare_at_price, badge, image_path, is_default, is_active")
      .eq("product_id", id)
      .order("position"),
  ]);
  if (!product) notFound();

  const updateAction = updateProduct.bind(null, product.id);

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        title={product.name}
        description="Edita los datos, imágenes y ofertas del producto."
        actions={
          <Link href={`/dashboard/landings?nuevo=${product.id}`} className={buttonVariants({ variant: "outline" })}>
            Crear landing de este producto
          </Link>
        }
      />
      <ProductForm action={updateAction} initial={product as ProductFormValues} submitLabel="Guardar cambios" />
      <ImagesManager storeId={store.id} productId={product.id} images={images ?? []} />
      <OffersManager
        storeId={store.id}
        productId={product.id}
        productPrice={Number(product.price)}
        initial={(offers ?? []).map((o) => ({
          ...o,
          price: Number(o.price),
          compare_at_price: o.compare_at_price === null ? null : Number(o.compare_at_price),
        }))}
      />
      <div className="flex justify-end border-t pt-6">
        <DeleteProductButton productId={product.id} />
      </div>
    </div>
  );
}
