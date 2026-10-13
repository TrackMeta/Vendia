import type { Metadata } from "next";
import { PageHeader } from "@/components/dashboard/page-header";
import { requireOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { CouriersSettings, type CourierSettingsRow } from "./couriers-settings";
import { SettingsForm } from "./settings-form";
import { parseSettingsTab } from "./settings-tabs";

export const metadata: Metadata = { title: "Configuración" };

export default async function SettingsPage({ searchParams }: PageProps<"/dashboard/configuracion">) {
  const { tab } = await searchParams;
  const { store } = await requireOwner();
  const supabase = await createClient();
  const [{ data: settings }, { data: couriers }] = await Promise.all([
    supabase.from("store_settings").select("*").eq("store_id", store.id).single(),
    supabase.from("store_couriers").select("courier_id, enabled, is_default, shipping_cost, return_shipments, origin_agency").eq("store_id", store.id),
  ]);

  return (
    <div className="max-w-3xl">
      <PageHeader title="Configuración" description="Datos de tu tienda y reglas de tus pedidos contraentrega." />
      <SettingsForm
        storeId={store.id}
        storeSlug={store.slug}
        initialTab={parseSettingsTab(tab)}
        couriers={<CouriersSettings rows={(couriers ?? []).map((c) => ({ ...c, shipping_cost: Number(c.shipping_cost) }) as CourierSettingsRow)} />}
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
          packaging_cost: Number(settings?.packaging_cost ?? 0),
          payment_methods: (settings?.payment_methods ?? ["Contraentrega"]).join(", "),
          real_sale_mode: settings?.real_sale_mode ?? "zone",
          ad_currency: settings?.ad_currency ?? "PEN",
          usd_rate: Number(settings?.usd_rate ?? 3.75),
          apply_igv: Boolean(settings?.apply_igv),
          contact_calls: ((settings?.contact_sequence as string[] | null) ?? ["call", "call", "call", "whatsapp"]).filter((s) => s === "call").length,
          contact_whatsapp: ((settings?.contact_sequence as string[] | null) ?? ["whatsapp"]).includes("whatsapp"),
        }}
      />
    </div>
  );
}
