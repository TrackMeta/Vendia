import { MousePointerClick } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, PageHeader } from "@/components/dashboard/page-header";
import { SimpleBadge } from "@/components/dashboard/status-badge";
import { requireStore } from "@/lib/auth";
import { displayPeruPhone, formatDateTime, formatMoney } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { AbandonedActions } from "./abandoned-actions";

export const metadata: Metadata = { title: "Formularios abandonados" };

const VIEWS = {
  pendientes: { label: "Por contactar", statuses: ["open", "contacted"] },
  recuperados: { label: "Recuperados", statuses: ["recovered"] },
  descartados: { label: "Descartados", statuses: ["dismissed"] },
} as const;
type View = keyof typeof VIEWS;

const STATUS = {
  open: { label: "Nuevo", tone: "info" },
  contacted: { label: "Contactado", tone: "progress" },
  recovered: { label: "Recuperado", tone: "success" },
  dismissed: { label: "Descartado", tone: "neutral" },
} as const;

export default async function AbandonedPage({ searchParams }: PageProps<"/dashboard/abandonados">) {
  const sp = await searchParams;
  const view: View = typeof sp.vista === "string" && sp.vista in VIEWS ? (sp.vista as View) : "pendientes";
  const { store } = await requireStore();
  const supabase = await createClient();
  const [{ data: rows }, { data: counts }] = await Promise.all([
    supabase
      .from("abandoned_checkouts")
      .select("id, customer_name, phone, email, district_name, province_name, offer_name, total, status, contacted_at, created_at, recovered_order_id, landing_pages (title)")
      .eq("store_id", store.id)
      .in("status", [...VIEWS[view].statuses])
      .order("created_at", { ascending: false })
      .limit(200),
    supabase.rpc("abandoned_status_counts", { p_store_id: store.id }),
  ]);
  const count = (v: View) => VIEWS[v].statuses.reduce((sum, st) => sum + Number(((counts ?? {}) as Record<string, number>)[st] ?? 0), 0);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Formularios abandonados"
        description="Personas que dejaron su celular en tu formulario pero no terminaron el pedido. Escríbeles: muchas compran. Se guardan 30 días."
      />
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {(Object.keys(VIEWS) as View[]).map((v) => (
          <Link
            key={v}
            href={`/dashboard/abandonados?vista=${v}`}
            className={cn("rounded-full border px-3 py-1 text-sm whitespace-nowrap", view === v ? "border-foreground bg-foreground text-background" : "hover:bg-muted")}
          >
            {VIEWS[v].label} <span className="opacity-60">{count(v)}</span>
          </Link>
        ))}
      </div>
      {!rows?.length ? (
        <EmptyState
          icon={MousePointerClick}
          title="Nada por aquí"
          description="Cuando alguien escriba su celular en tu formulario y no termine el pedido, aparecerá en esta lista."
        />
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((r) => {
            const landing = r.landing_pages as unknown as { title: string } | { title: string }[] | null;
            const landingTitle = Array.isArray(landing) ? landing[0]?.title : landing?.title;
            const firstName = (r.customer_name ?? "").split(" ")[0];
            const message = `Hola${firstName ? ` ${firstName}` : ""}, te escribimos de ${store.name}. Vimos que te interesó ${r.offer_name ? `«${r.offer_name}» de ` : ""}${landingTitle ?? "nuestro producto"}. ¿Te ayudamos a completar tu pedido? Pagas al recibir.`;
            const st = STATUS[r.status as keyof typeof STATUS];
            return (
              <div key={r.id} className="flex flex-wrap items-center gap-3 rounded-xl bg-card p-3 ring-1 ring-foreground/10">
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{r.customer_name || "Sin nombre"}</span>
                    <span className="text-sm text-muted-foreground">{displayPeruPhone(r.phone)}</span>
                    <SimpleBadge tone={st.tone}>{st.label}</SimpleBadge>
                  </div>
                  <span className="text-sm text-muted-foreground">
                    {[landingTitle, r.offer_name, r.total ? formatMoney(r.total) : null, [r.district_name, r.province_name].filter(Boolean).join(", ")].filter(Boolean).join(" · ")}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatDateTime(r.created_at)}
                    {r.contacted_at ? ` · contactado ${formatDateTime(r.contacted_at)}` : ""}
                    {r.recovered_order_id ? (
                      <>
                        {" · "}
                        <Link href={`/dashboard/pedidos/${r.recovered_order_id}`} className="text-primary hover:underline">
                          ver pedido
                        </Link>
                      </>
                    ) : null}
                  </span>
                </div>
                {r.status === "open" || r.status === "contacted" ? (
                  <AbandonedActions id={r.id} whatsappHref={`https://wa.me/${r.phone}?text=${encodeURIComponent(message)}`} contacted={r.status === "contacted"} />
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
