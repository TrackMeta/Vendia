import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentStore } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { buildCourierCsv, type ExportableOrder } from "@/modules/integrations/courier-export";
import { limaToday } from "@/modules/metrics/date-range";

/** Descarga la planilla Excel/CSV para el courier con los pedidos seleccionados. */
export async function POST(request: NextRequest) {
  const store = await getCurrentStore();
  if (!store) return NextResponse.redirect(new URL("/login", request.url), 303);

  const form = await request.formData();
  const ids = z.array(z.uuid()).min(1).max(500).safeParse(form.getAll("ids"));
  if (!ids.success) return NextResponse.json({ error: "Selección inválida" }, { status: 400 });

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("orders")
    .select(
      "order_number, created_at, customer_name, customer_phone, dni, department_name, province_name, district_name, district_code, address, reference, balance_due, total, customer_notes, order_items (product_name, offer_name, quantity)",
    )
    .eq("store_id", store.id)
    .in("id", ids.data)
    .order("order_number");
  if (error) return NextResponse.json({ error: "No se pudo exportar" }, { status: 500 });

  const orders = (data ?? []).map((o) => ({ ...o, items: o.order_items })) as unknown as ExportableOrder[];
  return new NextResponse(buildCourierCsv(orders), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="pedidos-${store.slug}-${limaToday()}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
