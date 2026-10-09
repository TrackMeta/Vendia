import { ExternalLink, LayoutTemplate } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, PageHeader } from "@/components/dashboard/page-header";
import { SimpleBadge } from "@/components/dashboard/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireOwner } from "@/lib/auth";
import { formatDateTime, one } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { NewLandingDialog } from "./new-landing-dialog";

export const metadata: Metadata = { title: "Landings" };

export default async function LandingsPage({ searchParams }: PageProps<"/dashboard/landings">) {
  const { nuevo } = await searchParams;
  const { store } = await requireOwner();
  const supabase = await createClient();

  const [{ data: landings }, { data: products }, { data: orderCounts }] = await Promise.all([
    supabase
      .from("landing_pages")
      .select("id, title, slug, status, updated_at, published_at, products (name)")
      .eq("store_id", store.id)
      .order("updated_at", { ascending: false }),
    supabase.from("products").select("id, name").eq("store_id", store.id).neq("status", "archived").order("name"),
    supabase.from("orders").select("landing_page_id").eq("store_id", store.id).not("landing_page_id", "is", null),
  ]);

  const counts = new Map<string, number>();
  for (const o of orderCounts ?? []) counts.set(o.landing_page_id!, (counts.get(o.landing_page_id!) ?? 0) + 1);

  const dialog = (
    <NewLandingDialog products={products ?? []} defaultProductId={typeof nuevo === "string" ? nuevo : undefined} />
  );

  return (
    <div>
      <PageHeader
        title="Landings"
        description="Imágenes + botones + botón fijo + formulario emergente. Edita, publica y pega el link en Meta Ads."
        actions={dialog}
      />
      {!landings?.length ? (
        <EmptyState
          icon={LayoutTemplate}
          title="Crea tu primera landing"
          description={products?.length ? "Empieza con la plantilla «Landing COD clásica» y solo sube tus imágenes." : "Primero crea un producto con sus imágenes y ofertas."}
          action={products?.length ? dialog : <Link href="/dashboard/productos/nuevo" className="text-sm font-medium underline">Crear producto</Link>}
        />
      ) : (
        <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Landing</TableHead>
                <TableHead className="hidden md:table-cell">Producto</TableHead>
                <TableHead className="text-right">Pedidos</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="hidden sm:table-cell">Actualizada</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {landings.map((l) => (
                <TableRow key={l.id}>
                  <TableCell>
                    <div className="flex flex-col">
                      <Link href={`/dashboard/landings/${l.id}`} className="font-medium hover:underline">
                        {l.title}
                      </Link>
                      {l.status === "published" ? (
                        <a
                          href={`/p/${store.slug}/${l.slug}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-xs text-muted-foreground hover:underline"
                        >
                          /p/{store.slug}/{l.slug} <ExternalLink className="size-3" />
                        </a>
                      ) : (
                        <span className="text-xs text-muted-foreground">/p/{store.slug}/{l.slug}</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">{one(l.products as unknown as { name: string }[])?.name}</TableCell>
                  <TableCell className="text-right">{counts.get(l.id) ?? 0}</TableCell>
                  <TableCell>
                    <SimpleBadge tone={l.status === "published" ? "success" : "neutral"}>
                      {l.status === "published" ? "Publicada" : "Borrador"}
                    </SimpleBadge>
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground sm:table-cell">{formatDateTime(l.updated_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
