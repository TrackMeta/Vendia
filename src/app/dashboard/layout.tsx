import type { Metadata } from "next";
import { requireStore } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { DashboardShell } from "./shell";

export const metadata: Metadata = { title: { default: "Panel", template: "%s · Vendia" } };

export default async function DashboardLayout({ children }: LayoutProps<"/dashboard">) {
  const { user, store } = await requireStore();
  const supabase = await createClient();
  const { data: unread } = await supabase.rpc("unread_notifications_count", { p_store_id: store.id });

  return (
    <DashboardShell
      storeName={store.name}
      storeSlug={store.slug}
      userEmail={user.email ?? ""}
      blocked={store.status === "blocked"}
      storeId={store.id}
      role={store.role}
      unread={typeof unread === "number" ? unread : 0}
    >
      {children}
    </DashboardShell>
  );
}
