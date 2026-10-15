import { Bell } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, PageHeader } from "@/components/dashboard/page-header";
import { getMyStores, requireStore } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { PhoneAlerts } from "@/components/dashboard/phone-alerts";
import { SoundSettings } from "@/components/dashboard/sound-settings";
import { DismissAllButton, DismissButton, MarkAllReadButton } from "./mark-all-read";

export const metadata: Metadata = { title: "Notificaciones" };

const TYPE_LABEL: Record<string, string> = {
  new_order: "🛒 Pedido nuevo",
  possible_duplicate: "⚠️ Posible duplicado",
  risky_customer: "🚩 Cliente riesgoso",
  sequence_done: "📵 Secuencia completa",
  callback_due: "⏰ Llamar",
  meta_failed: "❌ Meta",
  webhook_failed: "❌ Webhook",
  team: "👥 Equipo",
};

export default async function NotificationsPage() {
  const { user, store } = await requireStore();
  const supabase = await createClient();
  const [{ data: list }, myStores] = await Promise.all([
    supabase.from("notifications").select("id, type, title, body, link, created_at").eq("store_id", store.id).order("created_at", { ascending: false }).limit(100),
    getMyStores(),
  ]);
  // Leídas: solo de las notificaciones que se muestran (un límite fijo fallaba con muchas leídas)
  const ids = (list ?? []).map((n) => n.id);
  const { data: reads } = ids.length
    ? await supabase.from("notification_reads").select("notification_id").eq("user_id", user.id).in("notification_id", ids)
    : { data: [] as { notification_id: string }[] };
  const readSet = new Set((reads ?? []).map((r) => r.notification_id));
  const unread = (list ?? []).filter((n) => !readSet.has(n.id)).length;

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <PageHeader
        title="Notificaciones"
        description="Pedidos nuevos, clientes riesgosos y secuencias de contacto terminadas. Al borrarlas se quitan solo para ti."
        actions={
          list?.length ? (
            <div className="flex flex-wrap gap-2">
              {unread ? <MarkAllReadButton storeId={store.id} /> : null}
              <DismissAllButton storeId={store.id} />
            </div>
          ) : null
        }
      />
      <SoundSettings />
      <PhoneAlerts stores={myStores.map((s) => ({ id: s.id, name: s.name }))} />
      {!list?.length ? (
        <EmptyState icon={Bell} title="Sin notificaciones" description="Aquí verás cada pedido nuevo y los avisos importantes de tu tienda." />
      ) : (
        <div className="flex flex-col divide-y overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
          {list.map((n) => {
            const isUnread = !readSet.has(n.id);
            const content = (
              <div className={cn("flex flex-col gap-0.5 px-4 py-3 text-sm", isUnread && "bg-sky-50/60 dark:bg-sky-950/30")}>
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-muted-foreground">{TYPE_LABEL[n.type] ?? n.type}</span>
                  {isUnread ? <span className="size-1.5 rounded-full bg-sky-500" /> : null}
                  <span className="ml-auto text-xs text-muted-foreground">{formatDateTime(n.created_at)}</span>
                </span>
                <span className="font-medium">{n.title}</span>
                {n.body ? <span className="text-muted-foreground">{n.body}</span> : null}
              </div>
            );
            return (
              <div key={n.id} className="flex items-start">
                {n.link ? (
                  <Link href={n.link} className="min-w-0 flex-1 hover:bg-muted/40">
                    {content}
                  </Link>
                ) : (
                  <div className="min-w-0 flex-1">{content}</div>
                )}
                <div className={cn("self-stretch py-2 pr-2", isUnread && "bg-sky-50/60 dark:bg-sky-950/30")}>
                  <DismissButton storeId={store.id} id={n.id} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
