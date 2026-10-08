import type { Metadata } from "next";
import { PageHeader } from "@/components/dashboard/page-header";
import { createProduct } from "../actions";
import { ProductForm } from "../product-form";

export const metadata: Metadata = { title: "Nuevo producto" };

export default function NewProductPage() {
  return (
    <div className="max-w-3xl">
      <PageHeader title="Nuevo producto" description="Después de crearlo podrás subir imágenes y configurar ofertas por cantidad." />
      <ProductForm action={createProduct} submitLabel="Crear producto" />
    </div>
  );
}
