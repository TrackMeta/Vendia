import type { Metadata } from "next";
import { requireStore } from "@/lib/auth";
import { DashboardShell } from "./shell";

export const metadata: Metadata = { title: { default: "Panel", template: "%s · Vendia" } };

export default async function DashboardLayout({ children }: LayoutProps<"/dashboard">) {
  const { user, store } = await requireStore();

  return (
    <DashboardShell storeName={store.name} storeSlug={store.slug} userEmail={user.email ?? ""} blocked={store.status === "blocked"}>
      {children}
    </DashboardShell>
  );
}
