import { Bell } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, PageHeader } from "@/components/dashboard/page-header";
import { requireStore } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { MarkAllReadButton } from "./mark-all-read";

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
  const [{ data: list }, { data: reads }] = await Promise.all([
    supabase.from("notifications").select("id, type, title, body, link, created_at").eq("store_id", store.id).order("created_at", { ascending: false }).limit(100),
    supabase.from("notification_reads").select("notification_id").eq("user_id", user.id).limit(1000),
  ]);
  const readSet = new Set((reads ?? []).map((r) => r.notification_id));
  const unread = (list ?? []).filter((n) => !readSet.has(n.id)).length;

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <PageHeader
        title="Notificaciones"
        description="Pedidos nuevos, clientes riesgosos y secuencias de contacto terminadas."
        actions={unread ? <MarkAllReadButton storeId={store.id} /> : null}
      />
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
            return n.link ? (
              <Link key={n.id} href={n.link} className="hover:bg-muted/40">
                {content}
              </Link>
            ) : (
              <div key={n.id}>{content}</div>
            );
          })}
        </div>
      )}
    </div>
  );
}
