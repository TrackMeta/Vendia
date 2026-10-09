import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getMyStores, requireStore } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { parseTheme, THEME_COOKIE } from "@/lib/theme";
import { DashboardShell } from "./shell";

export const metadata: Metadata = { title: { default: "Panel", template: "%s · Vendia" } };

export default async function DashboardLayout({ children }: LayoutProps<"/dashboard">) {
  const { user, store } = await requireStore();
  const supabase = await createClient();
  const [{ data: unread }, stores, cookieStore] = await Promise.all([
    supabase.rpc("unread_notifications_count", { p_store_id: store.id }),
    getMyStores(),
    cookies(),
  ]);

  return (
    <DashboardShell
      storeName={store.name}
      storeSlug={store.slug}
      userEmail={user.email ?? ""}
      blocked={store.status === "blocked"}
      storeId={store.id}
      role={store.role}
      unread={typeof unread === "number" ? unread : 0}
      stores={stores.map((s) => ({ id: s.id, name: s.name, role: s.role, logo: s.logo }))}
      storeLogo={store.logo}
      theme={parseTheme(cookieStore.get(THEME_COOKIE)?.value)}
    >
      {children}
    </DashboardShell>
  );
}
