import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMoney, formatPercent } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { computeRowMetrics } from "@/modules/metrics";
import type { DateRange } from "@/modules/metrics/date-range";

export type GeoLevel = "department" | "province" | "district";

type Row = ReturnType<typeof computeRowMetrics> & { label: string; sublabel: string; href?: string };

function profitClass(v: number) {
  return v < 0 ? "text-destructive" : v > 0 ? "text-emerald-600 dark:text-emerald-400" : "";
}

/**
 * Zonas: pedidos, entregas y utilidad por departamento → provincia → distrito (clic para bajar de nivel).
 * Sirve para encontrar dónde se cancela o no se entrega y ajustar la segmentación o pedir adelanto.
 */
export async function ZonesView({
  storeId,
  range,
  level,
  parent,
  parentName,
  hrefFor,
}: {
  storeId: string;
  range: DateRange;
  level: GeoLevel;
  parent: string | null;
  parentName: string | null;
  hrefFor: (geo: { geo?: GeoLevel; padre?: string; nombre?: string }) => string;
}) {
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_geo_stats", { p_store_id: storeId, p_from: range.from, p_to: range.to, p_level: level, p_parent: parent });
  const nextLevel: GeoLevel | null = level === "department" ? "province" : level === "province" ? "district" : null;
  const rows: Row[] = ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    ...computeRowMetrics(r),
    label: String(r.name),
    sublabel: `${r.cancelled ?? 0} cancelados · ${r.failed ?? 0} no entregados`,
    href: nextLevel ? hrefFor({ geo: nextLevel, padre: String(r.code), nombre: String(r.name) }) : undefined,
  }));
  const first = level === "department" ? "Departamento" : level === "province" ? "Provincia" : "Distrito";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-1 text-sm">
        <Link href={hrefFor({})} className={level === "department" ? "font-semibold" : "text-muted-foreground hover:underline"}>
          Departamentos
        </Link>
        {parent ? (
          <>
            <ChevronRight className="size-3.5 text-muted-foreground" />
            <span className="font-semibold">{parentName ?? parent}</span>
            <span className="text-muted-foreground">({level === "province" ? "provincias" : "distritos"})</span>
          </>
        ) : null}
      </div>
      {rows.length ? (
        <div className="overflow-x-auto rounded-xl bg-card ring-1 ring-foreground/10">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{first}</TableHead>
                <TableHead className="text-right">Pedidos</TableHead>
                <TableHead className="text-right">Confirm.</TableHead>
                <TableHead className="text-right">Ventas</TableHead>
                <TableHead className="text-right" title="Ventas reales ÷ pedidos enviados">
                  Efectividad
                </TableHead>
                <TableHead className="text-right">Ingreso real</TableHead>
                <TableHead className="text-right">Utilidad</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.label + r.sublabel}>
                  <TableCell>
                    <div className="flex max-w-56 flex-col">
                      {r.href ? (
                        <Link href={r.href} className="flex items-center gap-1 font-medium hover:underline">
                          {r.label} <ChevronRight className="size-3.5" />
                        </Link>
                      ) : (
                        <span className="truncate font-medium">{r.label}</span>
                      )}
                      <span className="truncate text-xs text-muted-foreground">{r.sublabel}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{r.orders}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.confirmed}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.delivered}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatPercent(r.deliveryRate)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(r.revenue)}</TableCell>
                  <TableCell className={cn("text-right font-medium tabular-nums", profitClass(r.profit))}>{formatMoney(r.profit)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <p className="rounded-xl border border-dashed px-6 py-12 text-center text-sm text-muted-foreground">Sin pedidos en este periodo.</p>
      )}
      <p className="text-xs text-muted-foreground">Detecta zonas con alta cancelación o baja tasa de entrega para ajustar tu segmentación o pedir adelanto.</p>
    </div>
  );
}
