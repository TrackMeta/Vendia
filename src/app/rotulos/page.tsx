import type { Metadata } from "next";
import { z } from "zod";
import { requireStore } from "@/lib/auth";
import { publicAssetUrl } from "@/lib/env";
import { displayPeruPhone, formatMoney } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { courierName } from "@/modules/couriers";
import { itemLabel, type VariantBreakdown } from "@/modules/orders/items";
import { PrintButton } from "./print-button";

export const metadata: Metadata = { title: "Rótulos de envío", robots: { index: false } };

type Size = "a4" | "10x15";

/** Rótulos de envío para pegar en cada paquete: destinatario, dirección o agencia y cuánto cobrar. */
export default async function LabelsPage({ searchParams }: PageProps<"/rotulos">) {
  const sp = await searchParams;
  const { store } = await requireStore();
  const ids = z
    .array(z.uuid())
    .max(300)
    .safeParse(String(sp.ids ?? "").split(",").filter(Boolean));
  const size: Size = sp.tam === "10x15" ? "10x15" : "a4";
  const supabase = await createClient();
  const [{ data: orders }, { data: settings }] = await Promise.all([
    ids.success && ids.data.length
      ? supabase
          .from("orders")
          .select(
            "id, order_number, zone, customer_name, customer_phone, dni, address, reference, district_name, province_name, department_name, balance_due, agency_destination, courier_id, order_items (product_name, offer_name, quantity, variant_breakdown, kind)",
          )
          .eq("store_id", store.id)
          .in("id", ids.data)
          .order("order_number")
      : Promise.resolve({ data: [] }),
    supabase.from("store_settings").select("whatsapp, logo_path").eq("store_id", store.id).single(),
  ]);
  const logo = publicAssetUrl(settings?.logo_path);
  const qs = (tam: Size) => `/rotulos?ids=${ids.success ? ids.data.join(",") : ""}&tam=${tam}`;

  return (
    <main className="min-h-svh bg-zinc-100 p-4 print:bg-white print:p-0">
      <style>{`@page { size: ${size === "a4" ? "A4" : "100mm 150mm"}; margin: ${size === "a4" ? "8mm" : "4mm"}; }`}</style>
      <div className="mx-auto mb-4 flex max-w-4xl flex-wrap items-center gap-2 print:hidden">
        <h1 className="text-lg font-semibold">Rótulos de envío · {orders?.length ?? 0}</h1>
        <a href={qs("a4")} className={`rounded-md border px-3 py-1 text-sm ${size === "a4" ? "bg-zinc-900 text-white" : "bg-white"}`}>
          Hoja A4 (6 por hoja)
        </a>
        <a href={qs("10x15")} className={`rounded-md border px-3 py-1 text-sm ${size === "10x15" ? "bg-zinc-900 text-white" : "bg-white"}`}>
          Etiqueta 10×15 cm
        </a>
        <PrintButton />
      </div>
      {!orders?.length ? <p className="text-center text-sm text-zinc-500">Selecciona pedidos en Logística y toca «Rótulos».</p> : null}
      <div className={size === "a4" ? "mx-auto grid max-w-4xl grid-cols-2 gap-3 print:max-w-none print:gap-2" : "mx-auto flex max-w-sm flex-col gap-3 print:max-w-none print:gap-0"}>
        {(orders ?? []).map((o) => {
          const items = (o.order_items as { product_name: string; offer_name: string | null; quantity: number; variant_breakdown: VariantBreakdown; kind: string }[]) ?? [];
          const provincia = o.zone === "provincia";
          const toCollect = Number(o.balance_due);
          return (
            <section
              key={o.id}
              className={`flex break-inside-avoid flex-col gap-1.5 border-2 border-dashed border-zinc-400 bg-white p-3 text-[13px] leading-snug text-black ${
                size === "10x15" ? "h-[142mm] print:break-after-page" : "min-h-[85mm]"
              }`}
            >
              <div className="flex items-center justify-between gap-2 border-b border-zinc-300 pb-1.5">
                <div className="flex items-center gap-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {logo ? <img src={logo} alt="" className="h-7 w-auto" /> : null}
                  <span className="font-bold">{store.name}</span>
                </div>
                <span className="text-lg font-black">#{o.order_number}</span>
              </div>
              <p className="text-[11px] font-semibold text-zinc-500 uppercase">Destinatario</p>
              <p className="text-base leading-tight font-bold">{o.customer_name}</p>
              <p>
                Cel: <b>{displayPeruPhone(o.customer_phone)}</b>
                {o.dni ? (
                  <>
                    {" "}
                    · DNI: <b>{o.dni}</b>
                  </>
                ) : null}
              </p>
              {provincia ? (
                <p className="rounded bg-zinc-100 px-1.5 py-1">
                  Agencia {courierName(o.courier_id ?? "shalom")}: <b>{o.agency_destination ?? "—"}</b>
                  <br />
                  {o.district_name}, {o.province_name}, {o.department_name}
                </p>
              ) : (
                <p>
                  {o.address}
                  {o.reference ? <span className="block text-zinc-600">Ref: {o.reference}</span> : null}
                  <b>
                    {o.district_name}, {o.province_name}
                  </b>
                </p>
              )}
              <p className="text-[12px] text-zinc-700">{items.map((i) => itemLabel(i)).join(" + ")}</p>
              <div className="mt-auto flex items-end justify-between gap-2 border-t border-zinc-300 pt-1.5">
                <span className="text-[11px] text-zinc-600">
                  Remite: {store.name}
                  {settings?.whatsapp ? ` · ${settings.whatsapp}` : ""}
                  <br />
                  {courierName(o.courier_id)}
                </span>
                {provincia ? (
                  <span className="text-right text-[12px]">
                    Saldo: <b>{formatMoney(toCollect)}</b>
                  </span>
                ) : toCollect > 0 ? (
                  <span className="rounded bg-black px-2 py-1 text-right text-white">
                    COBRAR <b className="text-base">{formatMoney(toCollect)}</b>
                  </span>
                ) : (
                  <span className="font-bold">PAGADO</span>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </main>
  );
}
