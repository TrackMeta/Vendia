import type { Metadata } from "next";
import { PageHeader } from "@/components/dashboard/page-header";
import { SimpleBadge } from "@/components/dashboard/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getMyStores, requireOwner } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { dnsRecords, isApex } from "@/modules/domains";
import { vercelConnected } from "@/modules/domains/vercel";
import { AddDomainForm, DomainActions } from "./domain-controls";

export const metadata: Metadata = { title: "Dominios" };

export default async function DomainsPage() {
  const { user, store } = await requireOwner();
  const supabase = await createClient();
  const stores = (await getMyStores()).filter((s) => s.role === "owner");
  const [{ data: domains }, { data: landings }] = await Promise.all([
    supabase
      .from("custom_domains")
      .select("id, domain, store_id, status, verify_token, last_check_at, last_error, created_at")
      .eq("owner_id", user.id)
      .order("created_at"),
    // Landings publicadas de mis tiendas (la más reciente primero) para el link de ejemplo
    supabase
      .from("landing_pages")
      .select("slug, store_id")
      .in(
        "store_id",
        stores.map((s) => s.id),
      )
      .eq("status", "published")
      .order("published_at", { ascending: false })
      .limit(200),
  ]);
  const connected = vercelConnected();
  const storeName = (id: string | null) => (id ? (stores.find((s) => s.id === id)?.name ?? "Tienda") : "Todas mis tiendas");
  const landingOf = (storeId: string) => (landings ?? []).find((l) => l.store_id === storeId)?.slug;

  /** Link de ejemplo con una landing de la tienda del propio dominio. */
  const sampleFor = (domain: string, storeId: string | null) => {
    if (storeId) return `https://${domain}/${landingOf(storeId) ?? "mi-landing"}`;
    const withLanding = stores.find((s) => landingOf(s.id)) ?? stores.find((s) => s.id === store.id) ?? stores[0];
    return `https://${domain}/${withLanding?.slug ?? store.slug}/${(withLanding && landingOf(withLanding.id)) ?? "mi-landing"}`;
  };

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        title="Dominios"
        description="Muestra tus landings con tu propia marca, por ejemplo tutienda.pe/oferta. Tus clientes confían más y compran más."
      />

      <Card>
        <CardHeader>
          <CardTitle>Agregar dominio</CardTitle>
          <CardDescription>Compra el dominio donde prefieras (por ejemplo en punto.pe o Namecheap). Te recomendamos un subdominio como tienda.midominio.pe.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {!connected ? (
            <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
              Por ahora los dominios se guardan pero no se pueden activar: falta que el administrador de Vendia conecte Vercel. Escríbenos si lo necesitas.
            </p>
          ) : null}
          <AddDomainForm storeName={store.name} />
        </CardContent>
      </Card>

      {(domains ?? []).map((d) => {
        const records = dnsRecords(d.domain, d.verify_token);
        const sample = sampleFor(d.domain, d.store_id);
        const apex = isApex(d.domain);
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
                <>
                  <p>
                    Ejemplo:{" "}
                    <a href={sample} target="_blank" rel="noopener noreferrer" className="font-medium text-primary hover:underline">
                      {sample}
                    </a>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    En {d.domain}/ se ve tu landing publicada más reciente{apex ? `, y www.${d.domain} lleva a ${d.domain}` : ""}.
                  </p>
                </>
              ) : (
                <>
                  <p>En el panel de tu dominio crea estos registros DNS (los cambios pueden tardar unas horas):</p>
                  <div className="grid grid-cols-[auto_auto_1fr] gap-x-3 gap-y-2 rounded-lg bg-muted/50 p-3 font-mono text-xs">
                    <span className="font-sans text-muted-foreground">Tipo</span>
                    <span className="font-sans text-muted-foreground">Nombre</span>
                    <span className="font-sans text-muted-foreground">Valor</span>
                    {records.map((r) => (
                      <div key={`${r.type}-${r.name}`} className="contents">
                        <span>{r.type}</span>
                        <span className="break-all">{r.name}</span>
                        <span className="break-all">{r.value}</span>
                      </div>
                    ))}
                  </div>
                  <ul className="flex list-disc flex-col gap-1 pl-4 text-xs text-muted-foreground">
                    <li>El registro TXT prueba que el dominio es tuyo.</li>
                    {apex ? <li>Borra cualquier otro registro A o AAAA de «@»: solo debe quedar {records[0].value}.</li> : null}
                    <li>¿Usas Cloudflare? Apaga el proxy: la nube naranja debe quedar gris.</li>
                    <li>Vendia lo configura por ti; si no se activa en 24 h, escríbenos.</li>
                    <li>Si no se activa en 7 días, se quita solo (puedes volver a agregarlo).</li>
                  </ul>
                  {!connected ? <p className="text-xs text-amber-700">Este dominio aún no se puede activar: falta que el administrador de Vendia conecte Vercel.</p> : null}
                </>
              )}
              {d.last_error ? <p className="text-xs text-amber-700">{d.last_error}</p> : null}
              {d.last_check_at ? <p className="text-xs text-muted-foreground">Última verificación: {formatDateTime(d.last_check_at)}</p> : null}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
