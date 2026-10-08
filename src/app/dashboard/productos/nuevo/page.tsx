import type { Metadata } from "next";
import { PageHeader } from "@/components/dashboard/page-header";
import { requireOwner } from "@/lib/auth";
import { createProduct } from "../actions";
import { ProductForm } from "../product-form";

export const metadata: Metadata = { title: "Nuevo producto" };

export default async function NewProductPage() {
  await requireOwner();
  return (
    <div className="max-w-3xl">
      <PageHeader title="Nuevo producto" description="Después de crearlo podrás subir imágenes y configurar ofertas por cantidad." />
      <ProductForm action={createProduct} submitLabel="Crear producto" />
    </div>
  );
}
