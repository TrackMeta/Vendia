"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStore } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { COURIER_IDS, type VendiaExportOrder } from "@/modules/couriers";

export type ExportOrder = VendiaExportOrder & { id: string; zone: "lima" | "provincia" };

const SELECT =
  "id, zone, order_number, customer_name, customer_phone, dni, district_name, province_name, department_name, address, reference, balance_due, agency_destination, package_size, package_weight, order_items (product_id, offer_id, product_name, offer_name, quantity, variant_breakdown)";

type Row = Omit<ExportOrder, "items"> & {
  order_items: {
    product_id: string | null;
    offer_id: string | null;
    product_name: string;
    offer_name: string | null;
    quantity: number;
    variant_breakdown?: VendiaExportOrder["items"][number]["variant_breakdown"];
  }[];
};
type Product = NonNullable<VendiaExportOrder["items"][number]["product"]> & { id: string };
type Offer = NonNullable<VendiaExportOrder["items"][number]["offer"]> & { id: string };

/** Agrega medida y peso del producto/oferta (order_items no tiene FK a products: el historial sobrevive si se borra un producto). */
async function toExportOrders(supabase: Awaited<ReturnType<typeof createClient>>, rows: Row[]): Promise<ExportOrder[]> {
  const items = rows.flatMap((r) => r.order_items ?? []);
  const productIds = [...new Set(items.map((i) => i.product_id).filter((x): x is string => Boolean(x)))];
  const offerIds = [...new Set(items.map((i) => i.offer_id).filter((x): x is string => Boolean(x)))];
  const [{ data: products }, { data: offers }] = await Promise.all([
    productIds.length
      ? supabase.from("products").select("id, package_size, package_weight, package_height, package_width, package_length").in("id", productIds)
      : Promise.resolve({ data: [] as Product[] }),
    offerIds.length ? supabase.from("product_offers").select("id, package_size, package_weight").in("id", offerIds) : Promise.resolve({ data: [] as Offer[] }),
  ]);
  return rows.map(({ order_items, ...o }) => ({
    ...o,
    items: (order_items ?? []).map((i) => ({
      product_name: i.product_name,
      offer_name: i.offer_name,
      quantity: i.quantity,
      variant_breakdown: i.variant_breakdown ?? [],
      product: (products as Product[] | null)?.find((p) => p.id === i.product_id) ?? null,
      offer: (offers as Offer[] | null)?.find((x) => x.id === i.offer_id) ?? null,
    })),
  }));
}

const ids = z.array(z.uuid()).min(1).max(500);

/** Datos de los pedidos para la revisión previa (sin reservar nada). */
export async function getExportOrders(orderIds: string[]): Promise<{ ok: true; orders: ExportOrder[] } | { ok: false; error: string }> {
  const { store } = await requireStore();
  const parsed = ids.safeParse(orderIds);
  if (!parsed.success) return { ok: false, error: "Selección inválida" };
  const supabase = await createClient();
  const { data, error } = await supabase.from("orders").select(SELECT).eq("store_id", store.id).in("id", parsed.data).order("order_number");
  if (error) return { ok: false, error: "No se pudieron leer los pedidos" };
  return { ok: true, orders: await toExportOrders(supabase, (data ?? []) as unknown as Row[]) };
}

export type ReserveResult = { ok: true; batchId: string; orders: ExportOrder[]; skipped: number } | { ok: false; error: string };

/**
 * Reserva los pedidos (una sola sentencia en la base de datos: nadie más puede exportarlos)
 * y devuelve sus datos para generar el Excel en el navegador.
 */
export async function reserveExport(input: { courierId: string; orderIds: string[]; originAgency?: string; markShipped: boolean }): Promise<ReserveResult> {
  const { store } = await requireStore();
  const parsed = z
    .object({ courierId: z.enum(COURIER_IDS as [string, ...string[]]), orderIds: ids, originAgency: z.string().trim().max(120).optional(), markShipped: z.boolean() })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Datos inválidos" };
  const d = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("reserve_orders_for_export", {
    p_store_id: store.id,
    p_courier_id: d.courierId,
    p_order_ids: d.orderIds,
    p_origin_agency: d.originAgency || null,
    p_mark_shipped: d.markShipped,
  });
  if (error) return { ok: false, error: error.code === "P0001" ? error.message : "No se pudo reservar la exportación" };
  const r = data as { batch_id: string; order_ids: string[]; skipped: number };

  const { data: rows } = await supabase.from("orders").select(SELECT).eq("store_id", store.id).in("id", r.order_ids).order("order_number");
  revalidatePath("/dashboard/logistica");
  revalidatePath("/dashboard/pedidos");
  return { ok: true, batchId: r.batch_id, orders: await toExportOrders(supabase, (rows ?? []) as unknown as Row[]), skipped: r.skipped };
}

/** Vuelve a descargar un lote ya exportado (no reserva nada nuevo). */
export async function getBatchExport(
  batchId: string,
): Promise<{ ok: true; courierId: string; originAgency: string | null; orders: ExportOrder[] } | { ok: false; error: string }> {
  const { store } = await requireStore();
  if (!z.uuid().safeParse(batchId).success) return { ok: false, error: "Lote inválido" };
  const supabase = await createClient();
  const { data: batch } = await supabase.from("export_batches").select("id, courier_id, origin_agency").eq("id", batchId).eq("store_id", store.id).maybeSingle();
  if (!batch) return { ok: false, error: "Lote no encontrado" };
  const { data: rows } = await supabase.from("orders").select(SELECT).eq("store_id", store.id).eq("export_batch_id", batchId).order("order_number");
  return { ok: true, courierId: batch.courier_id, originAgency: batch.origin_agency, orders: await toExportOrders(supabase, (rows ?? []) as unknown as Row[]) };
}
