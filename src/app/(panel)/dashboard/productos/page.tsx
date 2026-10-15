import { Package, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, PageHeader } from "@/components/dashboard/page-header";
import { SimpleBadge } from "@/components/dashboard/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireOwner } from "@/lib/auth";
import { publicAssetUrl } from "@/lib/env";
import { formatMoney } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { PRODUCT_STATUS_LABELS } from "@/modules/products/schema";

export const metadata: Metadata = { title: "Productos" };

export default async function ProductsPage() {
  const { store } = await requireOwner();
  const supabase = await createClient();
  const { data: products } = await supabase
    .from("products")
    .select("id, name, sku, price, cost, stock, status, product_images (storage_path, is_primary)")
    .eq("store_id", store.id)
    .order("created_at", { ascending: false });

  return (
    <div>
      <PageHeader
        title="Productos"
        description="El precio, el costo y las ofertas de cada producto alimentan tus landings y tu utilidad real."
        actions={
          <Link href="/dashboard/productos/nuevo" className={buttonVariants()}>
            <Plus /> Nuevo producto
          </Link>
        }
      />
      {!products?.length ? (
        <EmptyState
          icon={Package}
          title="Crea tu primer producto"
          description="Agrega nombre, precio, costo e imágenes. Luego creas su landing page."
          action={
            <Link href="/dashboard/productos/nuevo" className={buttonVariants()}>
              <Plus /> Nuevo producto
            </Link>
          }
        />
      ) : (
        <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Producto</TableHead>
                <TableHead className="text-right">Precio</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Costo</TableHead>
                <TableHead className="hidden text-right md:table-cell">Stock</TableHead>
                <TableHead>Estado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {products.map((p) => {
                const images = p.product_images as { storage_path: string; is_primary: boolean }[];
                const thumb = publicAssetUrl((images.find((i) => i.is_primary) ?? images[0])?.storage_path);
                return (
                  <TableRow key={p.id}>
                    <TableCell>
                      <Link href={`/dashboard/productos/${p.id}`} className="flex items-center gap-3 font-medium hover:underline">
                        {thumb ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={thumb} alt="" className="size-10 rounded-md border object-cover" />
                        ) : (
                          <span className="flex size-10 items-center justify-center rounded-md border bg-muted">
                            <Package className="size-4 text-muted-foreground" />
                          </span>
                        )}
                        <span className="flex flex-col">
                          {p.name}
                          {p.sku ? <span className="text-xs font-normal text-muted-foreground">{p.sku}</span> : null}
                        </span>
                      </Link>
                    </TableCell>
                    <TableCell className="text-right">{formatMoney(p.price)}</TableCell>
                    <TableCell className="hidden text-right sm:table-cell">{formatMoney(p.cost)}</TableCell>
                    <TableCell className="hidden text-right md:table-cell">{p.stock ?? "—"}</TableCell>
                    <TableCell>
                      <SimpleBadge tone={p.status === "active" ? "success" : "neutral"}>
                        {PRODUCT_STATUS_LABELS[p.status as keyof typeof PRODUCT_STATUS_LABELS]}
                      </SimpleBadge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
