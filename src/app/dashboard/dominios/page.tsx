import type { Metadata } from "next";
import { PageHeader } from "@/components/dashboard/page-header";
import { SimpleBadge } from "@/components/dashboard/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getMyStores, requireOwner } from "@/lib/auth";
import { env } from "@/lib/env";
import { formatDateTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { dnsInstructions } from "@/modules/domains";
import { AddDomainForm, DomainActions } from "./domain-controls";

export const metadata: Metadata = { title: "Dominios" };

export default async function DomainsPage() {
  const { user, store } = await requireOwner();
  const supabase = await createClient();
  const [{ data: domains }, stores, { data: landing }] = await Promise.all([
    supabase.from("custom_domains").select("id, domain, store_id, status, last_check_at, last_error, created_at").eq("owner_id", user.id).order("created_at"),
    getMyStores(),
    supabase.from("landing_pages").select("slug").eq("store_id", store.id).eq("status", "published").limit(1).maybeSingle(),
  ]);
  const storeName = (id: string | null) => (id ? (stores.find((s) => s.id === id)?.name ?? "Tienda") : "Todas mis tiendas");
  const storeSlug = (id: string | null) => stores.find((s) => s.id === id)?.slug;
  const example = landing?.slug ?? "mi-landing";

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        title="Dominios"
        description={`Tus landings ya funcionan en ${new URL(env.siteUrl()).host}/p/${store.slug}/… Con un dominio propio se ven más confiables (y no cambian si cambias de plataforma).`}
      />

      <Card>
        <CardHeader>
          <CardTitle>Agregar dominio</CardTitle>
          <CardDescription>Compra el dominio donde prefieras (por ejemplo en punto.pe o Namecheap). Te recomendamos un subdominio como tienda.midominio.pe.</CardDescription>
        </CardHeader>
        <CardContent>
          <AddDomainForm storeName={store.name} />
        </CardContent>
      </Card>

      {(domains ?? []).map((d) => {
        const dns = dnsInstructions(d.domain);
        const sample = d.store_id ? `https://${d.domain}/${example}` : `https://${d.domain}/${storeSlug(store.id) ?? store.slug}/${example}`;
        return (
          <Card key={d.id}>
            <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
              <div className="flex flex-col gap-1">
                <CardTitle className="flex items-center gap-2">
                  {d.domain}
                  <SimpleBadge tone={d.status === "active" ? "success" : "info"}>{d.status === "active" ? "Activo" : "Pendiente"}</SimpleBadge>
                </CardTitle>
                <CardDescription>{storeName(d.store_id)}</CardDescription>
              </div>
              <DomainActions id={d.id} />
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
              {d.status === "active" ? (
                <p>
                  Ejemplo:{" "}
                  <a href={sample} target="_blank" rel="noopener noreferrer" className="font-medium text-primary hover:underline">
                    {sample}
                  </a>
                </p>
              ) : (
                <>
                  <p>En el panel de tu dominio crea este registro DNS (los cambios pueden tardar unas horas):</p>
                  <div className="grid grid-cols-3 gap-2 rounded-lg bg-muted/50 p-3 font-mono text-xs">
                    <span className="font-sans text-muted-foreground">Tipo</span>
                    <span className="font-sans text-muted-foreground">Nombre</span>
                    <span className="font-sans text-muted-foreground">Valor</span>
                    <span>{dns.type}</span>
                    <span>{dns.name}</span>
                    <span className="break-all">{dns.value}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Si tu Vendia no lo agregó solo, entra a Vercel → tu proyecto → Settings → Domains y agrega <b>{d.domain}</b>.
                  </p>
                </>
              )}
              {d.last_error && d.status !== "active" ? <p className="text-xs text-amber-700">{d.last_error}</p> : null}
              {d.last_check_at ? <p className="text-xs text-muted-foreground">Última verificación: {formatDateTime(d.last_check_at)}</p> : null}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
