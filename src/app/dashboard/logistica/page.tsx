import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/dashboard/page-header";
import { requireStore } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import type { OrderStatus } from "@/modules/orders/state-machine";
import { LogisticsTable, type LogisticsOrder } from "./logistics-table";

export const metadata: Metadata = { title: "Logística" };

const VIEWS = {
  confirmar: { label: "Por confirmar", statuses: ["new", "pending_confirmation"] as OrderStatus[] },
  despachar: { label: "Por despachar", statuses: ["confirmed", "preparing"] as OrderStatus[] },
  "en-camino": { label: "En camino", statuses: ["shipped", "out_for_delivery"] as OrderStatus[] },
} as const;

type ViewKey = keyof typeof VIEWS;

export default async function LogisticsPage({ searchParams }: PageProps<"/dashboard/logistica">) {
  const sp = await searchParams;
  const view: ViewKey = typeof sp.vista === "string" && sp.vista in VIEWS ? (sp.vista as ViewKey) : "confirmar";
  const { store } = await requireStore();
  const supabase = await createClient();

  const [{ data: orders }, { data: counts }] = await Promise.all([
    supabase
      .from("orders")
      .select(
        "id, order_number, created_at, status, customer_name, customer_phone, total, balance_due, address, reference, district_name, province_name, department_name, is_possible_duplicate, courier_name, tracking_code, order_items (product_name, offer_name, quantity)",
      )
      .eq("store_id", store.id)
      .in("status", VIEWS[view].statuses)
      .order("created_at", { ascending: true })
      .limit(300),
    supabase.from("orders").select("status").eq("store_id", store.id).in("status", Object.values(VIEWS).flatMap((v) => v.statuses)),
  ]);

  const countFor = (key: ViewKey) => (counts ?? []).filter((c) => (VIEWS[key].statuses as string[]).includes(c.status)).length;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Logística"
        description="Confirma por WhatsApp, prepara el despacho, descarga la planilla para tu courier y marca las entregas."
      />
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {(Object.keys(VIEWS) as ViewKey[]).map((key) => (
          <Link
            key={key}
            href={`/dashboard/logistica?vista=${key}`}
            className={cn(
              "rounded-full border px-3 py-1 text-sm whitespace-nowrap",
              view === key ? "border-foreground bg-foreground text-background" : "hover:bg-muted",
            )}
          >
            {VIEWS[key].label} <span className="opacity-60">{countFor(key)}</span>
          </Link>
        ))}
      </div>
      <LogisticsTable
        view={view}
        storeName={store.name}
        orders={(orders ?? []).map((o) => ({ ...o, total: Number(o.total), balance_due: Number(o.balance_due) }) as LogisticsOrder)}
      />
    </div>
  );
}
