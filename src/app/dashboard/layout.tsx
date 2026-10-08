import type { Metadata } from "next";
import { getMyStores, requireStore } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { DashboardShell } from "./shell";

export const metadata: Metadata = { title: { default: "Panel", template: "%s · Vendia" } };

export default async function DashboardLayout({ children }: LayoutProps<"/dashboard">) {
  const { user, store } = await requireStore();
  const supabase = await createClient();
  const [{ data: unread }, stores] = await Promise.all([supabase.rpc("unread_notifications_count", { p_store_id: store.id }), getMyStores()]);

  return (
    <DashboardShell
      storeName={store.name}
      storeSlug={store.slug}
      userEmail={user.email ?? ""}
      blocked={store.status === "blocked"}
      storeId={store.id}
      role={store.role}
      unread={typeof unread === "number" ? unread : 0}
      stores={stores.map((s) => ({ id: s.id, name: s.name, role: s.role }))}
    >
      {children}
    </DashboardShell>
  );
}
