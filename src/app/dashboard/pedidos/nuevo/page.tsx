import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/dashboard/page-header";
import { requireStore } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ManualOrderForm } from "./manual-order-form";

export const metadata: Metadata = { title: "Nuevo pedido" };

export default async function NewOrderPage() {
  const { store } = await requireStore();
  const supabase = await createClient();
  const [{ data: products }, { data: offers }, { data: settings }, { data: variants }] = await Promise.all([
    supabase.from("products").select("id, name, price, variant_label").eq("store_id", store.id).neq("status", "archived").order("name"),
    supabase.from("product_offers").select("id, product_id, name, quantity, price").eq("store_id", store.id).eq("is_active", true).order("position"),
    supabase.from("store_settings").select("shipping_lima, shipping_province, advance_amount").eq("store_id", store.id).maybeSingle(),
    supabase.from("product_variants").select("id, product_id, name, stock").eq("store_id", store.id).eq("is_active", true).order("position"),
  ]);

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <Link href="/dashboard/pedidos" className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Pedidos
      </Link>
      <PageHeader title="Nuevo pedido" description="Para pedidos que llegan por WhatsApp, Instagram, Facebook o llamada. Se valida la ubicación igual que en la landing." />
      {!products?.length ? (
        <p className="rounded-md bg-muted p-4 text-sm">Primero crea un producto.</p>
      ) : (
        <ManualOrderForm
          products={products.map((p) => ({
            id: p.id,
            name: p.name,
            price: Number(p.price),
            variantLabel: p.variant_label,
            variants: (variants ?? []).filter((v) => v.product_id === p.id).map((v) => ({ id: v.id, name: v.name, stock: v.stock })),
          }))}
          offers={(offers ?? []).map((o) => ({ id: o.id, productId: o.product_id, name: o.name, quantity: o.quantity, price: Number(o.price) }))}
          shipping={{ lima: Number(settings?.shipping_lima ?? 0), province: Number(settings?.shipping_province ?? 0) }}
          defaultAdvance={Number(settings?.advance_amount ?? 0)}
        />
      )}
    </div>
  );
}
