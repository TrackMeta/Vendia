import type { Metadata } from "next";
import { PageHeader } from "@/components/dashboard/page-header";
import { requireStore } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { SettingsForm } from "./settings-form";

export const metadata: Metadata = { title: "Configuración" };

export default async function SettingsPage() {
  const { store } = await requireStore();
  const supabase = await createClient();
  const { data: settings } = await supabase.from("store_settings").select("*").eq("store_id", store.id).single();

  return (
    <div className="max-w-3xl">
      <PageHeader title="Configuración" description="Datos de tu tienda y reglas de tus pedidos contraentrega." />
      <SettingsForm
        storeId={store.id}
        storeSlug={store.slug}
        initial={{
          name: store.name,
          whatsapp: settings?.whatsapp ?? "",
          phone: settings?.phone ?? "",
          email: settings?.email ?? "",
          address: settings?.address ?? "",
          logo_path: settings?.logo_path ?? "",
          favicon_path: settings?.favicon_path ?? "",
          shipping_lima: Number(settings?.shipping_lima ?? 0),
          shipping_province: Number(settings?.shipping_province ?? 0),
          advance_amount: Number(settings?.advance_amount ?? 0),
          payment_methods: (settings?.payment_methods ?? ["Contraentrega"]).join(", "),
          confirmation_message: settings?.confirmation_message ?? "",
          purchase_trigger_status: settings?.purchase_trigger_status ?? "delivered",
        }}
      />
    </div>
  );
}
