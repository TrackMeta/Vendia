import type { Metadata } from "next";
import Link from "next/link";
import { LiveRefresh } from "@/components/dashboard/notifications";
import { PageHeader } from "@/components/dashboard/page-header";
import { requireStore } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { type ContactChannel, DEFAULT_SEQUENCE, sortForConfirmation } from "@/modules/orders/contact";
import type { OrderStatus } from "@/modules/orders/state-machine";
import { type BatchRow, BatchesList, type StoreCourier } from "./export-dialog";
import { LogisticsTable, type LogisticsOrder } from "./logistics-table";

export const metadata: Metadata = { title: "Logística" };

const VIEWS = {
  confirmar: { label: "Por confirmar", statuses: ["new", "pending_confirmation"] as OrderStatus[] },
  despachar: { label: "Por despachar", statuses: ["confirmed", "preparing"] as OrderStatus[] },
  // En provincia, «Cobrado» llega antes que «Entregado»: sigue en camino hasta que lo recoge
  "en-camino": { label: "En camino", statuses: ["shipped", "out_for_delivery", "at_agency", "collected"] as OrderStatus[] },
} as const;

const IN_TRANSIT_FILTER = "status.in.(shipped,out_for_delivery,at_agency),and(status.eq.collected,zone.eq.provincia,delivered_at.is.null)";


type ViewKey = keyof typeof VIEWS;
const ZONES = { todas: "Todas", lima: "Lima", provincia: "Provincia" } as const;

export default async function LogisticsPage({ searchParams }: PageProps<"/dashboard/logistica">) {
  const sp = await searchParams;
  const view: ViewKey = typeof sp.vista === "string" && sp.vista in VIEWS ? (sp.vista as ViewKey) : "confirmar";
  const zone = sp.zona === "lima" || sp.zona === "provincia" ? sp.zona : "todas";
  const mine = sp.mios === "1";
  const { user, store } = await requireStore();
  const supabase = await createClient();

  let query = supabase
    .from("orders")
    .select(
      "id, order_number, created_at, status, zone, customer_name, customer_phone, dni, total, balance_due, address, reference, district_name, province_name, department_name, is_possible_duplicate, risk_reasons, courier_name, tracking_code, agency_destination, exported_at, assigned_to, contact_attempts, last_contact_result, last_contact_at, next_contact_at, contact_sequence_done, source, source_channel, order_items (product_name, offer_name, quantity, variant_breakdown)",
    )
    .eq("store_id", store.id)
    .order("created_at", { ascending: true })
    .limit(300);
  query = view === "en-camino" ? query.or(IN_TRANSIT_FILTER) : query.in("status", VIEWS[view].statuses);
  if (zone !== "todas") query = query.eq("zone", zone);
  if (mine) query = query.eq("assigned_to", user.id);

  const [{ data: orders }, { data: counts }, { data: settings }, { data: team }, { data: couriers }, { data: batches }] = await Promise.all([
    query,
    supabase.rpc("logistics_counts", { p_store_id: store.id }),
    supabase.from("store_settings").select("contact_sequence").eq("store_id", store.id).maybeSingle(),
    supabase.rpc("get_store_team", { p_store_id: store.id }),
    supabase.from("store_couriers").select("courier_id, zone, enabled, is_default, origin_agency").eq("store_id", store.id),
    view === "despachar"
      ? supabase
          .from("export_batches")
          .select("id, courier_id, order_count, created_at, created_by")
          .eq("store_id", store.id)
          .order("created_at", { ascending: false })
          .limit(8)
      : Promise.resolve({
          data: [] as {
            id: string;
            courier_id: string;
            order_count: number;
            created_at: string;
            created_by: string | null;
          }[],
        }),
  ]);

  // Contadores calculados en la base (sin el límite de 1000 filas)
  const countFor = (key: ViewKey) => Number(((counts ?? {}) as Record<string, number>)[key === "en-camino" ? "en_camino" : key] ?? 0);
  const sequence = ((settings?.contact_sequence as ContactChannel[] | null) ?? DEFAULT_SEQUENCE).filter((s) => s === "call" || s === "whatsapp");
  const rows = (orders ?? []).map(
    (o) =>
      ({
        ...o,
        total: Number(o.total),
        balance_due: Number(o.balance_due),
      }) as LogisticsOrder,
  );
  const sorted = view === "confirmar" ? sortForConfirmation(rows) : rows;
  const members = (
    (team ?? []) as {
      user_id: string;
      email: string;
      full_name: string | null;
      color: string | null;
    }[]
  ).map((m) => ({
    id: m.user_id,
    name: m.full_name || m.email,
    color: m.color,
  }));
  const batchRows: BatchRow[] = (batches ?? []).map((b) => ({
    id: b.id,
    courier_id: b.courier_id,
    order_count: b.order_count,
    created_at: b.created_at,
    created_by_name: b.created_by === user.id ? "Tú" : (members.find((m) => m.id === b.created_by)?.name ?? "Equipo"),
  }));

  const href = (params: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    const merged: Record<string, string | undefined> = {
      vista: view,
      zona: zone !== "todas" ? zone : undefined,
      mios: mine ? "1" : undefined,
      ...params,
    };
    for (const [k, v] of Object.entries(merged)) if (v) next.set(k, v);
    return `/dashboard/logistica?${next.toString()}`;
  };

  return (
    <div className="flex flex-col gap-4">
      <LiveRefresh />
      <PageHeader
        title="Logística"
        description="Confirma por llamada o WhatsApp, prepara el despacho, descarga la planilla para tu courier y marca las entregas."
      />
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {(Object.keys(VIEWS) as ViewKey[]).map((key) => (
          <Link
            key={key}
            href={href({ vista: key })}
            className={cn(
              "rounded-full border px-3 py-1 text-sm whitespace-nowrap",
              view === key ? "border-foreground bg-foreground text-background" : "hover:bg-muted",
            )}
          >
            {VIEWS[key].label} <span className="opacity-60">{countFor(key)}</span>
          </Link>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-sm">
        {(Object.keys(ZONES) as (keyof typeof ZONES)[]).map((z) => (
          <Link
            key={z}
            href={href({ zona: z === "todas" ? undefined : z })}
            className={cn("rounded-md border px-2.5 py-0.5", zone === z ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted")}
          >
            {ZONES[z]}
          </Link>
        ))}
        <span className="mx-1 text-muted-foreground">·</span>
        <Link
          href={href({ mios: mine ? undefined : "1" })}
          className={cn("rounded-md border px-2.5 py-0.5", mine ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted")}
        >
          Mis pendientes
        </Link>
      </div>
      <LogisticsTable
        view={view}
        storeName={store.name}
        orders={sorted.map((o) => ({ ...o, order_items: o.order_items ?? [] }))}
        sequence={sequence}
        members={members}
        currentUserId={user.id}
        couriers={(couriers ?? []) as StoreCourier[]}
      />
      {view === "despachar" ? <BatchesList batches={batchRows} /> : null}
    </div>
  );
}
