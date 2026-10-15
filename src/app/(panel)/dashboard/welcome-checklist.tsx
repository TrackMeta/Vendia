import { ArrowRight, CheckCircle2, Circle } from "lucide-react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { DismissWelcome } from "./welcome-dismiss";

type Step = { key: string; title: string; text: string; href: string; done: boolean; optional?: boolean };

/** Tutorial de bienvenida: pasos guiados según lo que la tienda ya hizo. Se oculta al terminar o si el dueño lo cierra. */
export async function WelcomeChecklist({ storeId }: { storeId: string }) {
  const supabase = await createClient();
  const [{ data: settings }, { count: products }, { count: offers }, { count: published }, { data: meta }, { data: team }, { count: orders }, { data: couriers }] = await Promise.all([
    supabase.from("store_settings").select("whatsapp, shipping_lima, shipping_province, onboarding_dismissed").eq("store_id", storeId).single(),
    supabase.from("products").select("id", { count: "exact", head: true }).eq("store_id", storeId).eq("status", "active"),
    supabase.from("product_offers").select("id", { count: "exact", head: true }).eq("store_id", storeId).eq("is_active", true),
    supabase.from("landing_pages").select("id", { count: "exact", head: true }).eq("store_id", storeId).eq("status", "published"),
    supabase.from("store_meta_settings").select("ad_account_id, pixel_id, enabled").eq("store_id", storeId).maybeSingle(),
    supabase.rpc("get_store_team", { p_store_id: storeId }),
    supabase.from("orders").select("id", { count: "exact", head: true }).eq("store_id", storeId),
    supabase.from("store_couriers").select("courier_id, origin_agency").eq("store_id", storeId).eq("enabled", true),
  ]);
  if (settings?.onboarding_dismissed) return null;

  const steps: Step[] = [
    { key: "store", title: "Datos de tu tienda", text: "Tu WhatsApp, logo y el costo de envío a Lima y provincia.", href: "/dashboard/configuracion", done: Boolean(settings?.whatsapp) },
    {
      key: "couriers",
      title: "Couriers",
      text: "Activa Eva y Shalom, su costo y tu agencia de origen de Shalom.",
      href: "/dashboard/configuracion",
      done: (couriers ?? []).some((c) => c.courier_id === "shalom" && c.origin_agency),
    },
    { key: "product", title: "Tu primer producto", text: "Con fotos, costo y sus ofertas (1 unidad, 2x…).", href: "/dashboard/productos", done: Boolean(products && offers) },
    { key: "landing", title: "Publica tu landing", text: "Elige una plantilla, edítala y publícala.", href: "/dashboard/landings", done: Boolean(published) },
    {
      key: "meta",
      title: "Conecta Meta",
      text: "Para medir tu CPA real y enviar las ventas a tu Pixel.",
      href: "/dashboard/marketing",
      done: Boolean(meta?.ad_account_id || (meta?.pixel_id && meta.enabled)),
    },
    { key: "team", title: "Invita a tu equipo", text: "Un confirmador que llame y despache.", href: "/dashboard/equipo", done: ((team as unknown[] | null)?.length ?? 0) > 1, optional: true },
    { key: "order", title: "Recibe tu primer pedido", text: "Pega el link de tu landing en tu anuncio y confírmalo desde Logística.", href: "/dashboard/logistica", done: Boolean(orders) },
  ];
  const required = steps.filter((s) => !s.optional);
  const done = steps.filter((s) => s.done).length;
  if (required.every((s) => s.done)) return null;
  const next = steps.find((s) => !s.done);

  const pct = Math.round((done / steps.length) * 100);

  // Compacta: una franja con el progreso y el siguiente paso; la lista completa se despliega a pedido
  return (
    <Card size="sm">
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex min-w-48 flex-1 flex-col gap-1.5">
            <p className="text-sm">
              <span className="font-medium">Configura tu tienda</span>
              <span className="text-muted-foreground">
                {" "}
                · {done} de {steps.length} pasos
              </span>
            </p>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
            </div>
          </div>
          {next ? (
            <Link href={next.href} className="flex items-center gap-1.5 rounded-lg bg-foreground px-3 py-1.5 text-sm font-medium text-background hover:bg-foreground/85">
              Siguiente: {next.title} <ArrowRight className="size-3.5" />
            </Link>
          ) : null}
          <DismissWelcome />
        </div>
        <details className="group">
          <summary className="w-fit cursor-pointer list-none text-xs text-muted-foreground hover:text-foreground">
            <span className="group-open:hidden">Ver todos los pasos</span>
            <span className="hidden group-open:inline">Ocultar pasos</span>
          </summary>
          <ol className="mt-3 grid gap-2 sm:grid-cols-2">
            {steps.map((s) => (
              <li key={s.key}>
                <Link href={s.href} className={`flex gap-2.5 rounded-lg border p-2.5 hover:bg-muted/50 ${s.key === next?.key ? "border-primary/50 bg-primary/5" : ""}`}>
                  {s.done ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" /> : <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
                  <span className="flex flex-col">
                    <span className={`text-sm font-medium ${s.done ? "text-muted-foreground line-through" : ""}`}>
                      {s.title}
                      {s.optional ? <span className="font-normal text-muted-foreground"> (opcional)</span> : null}
                    </span>
                    <span className="text-xs text-muted-foreground">{s.text}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ol>
          <Link href="/dashboard/ayuda" className="mt-3 inline-block text-sm text-primary hover:underline">
            ¿Dudas? Mira la guía de ayuda
          </Link>
        </details>
      </CardContent>
    </Card>
  );
}
