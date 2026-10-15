"use client";

import { Loader2, RefreshCw, Trophy } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { ToggleField } from "@/components/dashboard/fields";
import { Button } from "@/components/ui/button";
import { formatMoney, formatNumber, formatPercent } from "@/lib/format";
import type { PublicOffer } from "@/modules/landing/types";
import { finishPriceTest, getPriceTestResults, type LandingSettings, type PriceTestRow } from "../actions";

type PriceTest = LandingSettings["price_test"];

/** Con menos visitas por versión, la diferencia todavía puede ser suerte. */
const MIN_VISITS = 100;

const ratio = (a: number, b: number) => (b > 0 ? a / b : null);
const profitOf = (r: PriceTestRow) => r.revenue - r.product_cost - r.shipping_cost;

/**
 * Prueba A/B de precio en esta landing: la mitad de las visitas ve el precio B (y se le cobra ese
 * precio). Compara qué versión deja más utilidad por visita, no solo cuál vende más.
 */
export function PriceTestSection({
  landingId,
  offers,
  value,
  onChange,
}: {
  landingId: string;
  offers: PublicOffer[];
  value: PriceTest;
  onChange: (next: PriceTest) => void;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<PriceTestRow[] | null>(null);
  const [loading, startLoading] = useTransition();
  const [finishing, startFinishing] = useTransition();

  const load = useCallback(
    () =>
      startLoading(async () => {
        const r = await getPriceTestResults(landingId);
        if (r.ok) setRows(r.rows);
        else toast.error(r.error);
      }),
    [landingId],
  );

  useEffect(() => {
    if (value.enabled && value.started_at) load();
  }, [value.enabled, value.started_at, load]);

  const setPrice = (offerId: string, raw: string) => {
    const n = Number(raw.replace(",", "."));
    const next = { ...value.offers };
    if (raw.trim() === "" || !(n > 0)) delete next[offerId];
    else next[offerId] = Math.round(n * 100) / 100;
    onChange({ ...value, offers: next });
  };

  const finish = (keep: "A" | "B") => {
    const msg = keep === "B" ? "¿Pasar los precios B a tus ofertas? Valen para todas las landings de este producto." : "¿Terminar la prueba y quedarte con los precios de siempre?";
    if (!confirm(msg)) return;
    startFinishing(async () => {
      const r = await finishPriceTest(landingId, keep);
      if (!r.ok) return void toast.error(r.error);
      toast.success(r.message ?? "Listo");
      onChange({ enabled: false, offers: {}, started_at: null });
      setRows(null);
      router.refresh();
    });
  };

  const a = rows?.find((r) => r.variant === "A");
  const b = rows?.find((r) => r.variant === "B");
  const enoughData = Boolean(a && b && a.visits >= MIN_VISITS && b.visits >= MIN_VISITS);
  const perVisit = (r?: PriceTestRow) => (r ? ratio(profitOf(r), r.visits) : null);
  const winner = enoughData && a && b ? ((perVisit(b) ?? 0) > (perVisit(a) ?? 0) ? "B" : "A") : null;

  return (
    <div className="flex flex-col gap-3">
      <ToggleField
        label="Activar la prueba de precio"
        hint="La mitad de tus visitas ve el precio B. Cada cliente ve siempre el mismo precio y se le cobra ese. Guarda para activarla."
        checked={value.enabled}
        onChange={(enabled) => onChange({ ...value, enabled, started_at: enabled ? value.started_at : null })}
      />
      {value.enabled ? (
        <>
          <div className="flex flex-col gap-2">
            <div className="grid grid-cols-[1fr_5rem_5.5rem] gap-2 text-xs text-muted-foreground">
              <span>Oferta</span>
              <span className="text-right">Precio A</span>
              <span className="text-right">Precio B</span>
            </div>
            {offers.map((o) => (
              <div key={o.id} className="grid grid-cols-[1fr_5rem_5.5rem] items-center gap-2 text-sm">
                <span className="truncate">{o.name}</span>
                <span className="text-right tabular-nums text-muted-foreground">{formatMoney(o.price)}</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.1"
                  value={value.offers[o.id] ?? ""}
                  onChange={(e) => setPrice(o.id, e.target.value)}
                  placeholder="—"
                  className="h-8 rounded-md border bg-transparent px-2 text-right text-sm tabular-nums"
                  aria-label={`Precio B de ${o.name}`}
                />
              </div>
            ))}
            <p className="text-xs text-muted-foreground">Deja vacío el precio B de las ofertas que no quieras probar.</p>
          </div>

          {value.started_at ? (
            <div className="flex flex-col gap-2 rounded-lg border p-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Resultados</p>
                <Button size="xs" variant="ghost" onClick={load} disabled={loading}>
                  {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />} Actualizar
                </Button>
              </div>
              {a && b ? (
                <table className="w-full text-xs tabular-nums">
                  <thead>
                    <tr className="text-muted-foreground">
                      <th className="py-1 text-left font-normal" />
                      <th className="py-1 text-right font-normal">A</th>
                      <th className="py-1 text-right font-normal">B</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(
                      [
                        ["Visitas", (r: PriceTestRow) => formatNumber(r.visits)],
                        ["Abrieron el formulario", (r: PriceTestRow) => formatNumber(r.form_opens)],
                        ["Pedidos", (r: PriceTestRow) => formatNumber(r.orders)],
                        ["Pedidos por visita", (r: PriceTestRow) => formatPercent(ratio(r.orders, r.visits))],
                        ["Ventas reales", (r: PriceTestRow) => formatNumber(r.delivered)],
                        ["Ingreso real", (r: PriceTestRow) => formatMoney(r.revenue)],
                        ["Utilidad", (r: PriceTestRow) => formatMoney(profitOf(r))],
                        ["Utilidad por visita", (r: PriceTestRow) => formatMoney(perVisit(r))],
                      ] as const
                    ).map(([label, fmt]) => (
                      <tr key={label} className="border-t">
                        <td className="py-1.5 text-muted-foreground">{label}</td>
                        <td className={`py-1.5 text-right ${winner === "A" && label === "Utilidad por visita" ? "font-semibold text-emerald-600" : ""}`}>{fmt(a)}</td>
                        <td className={`py-1.5 text-right ${winner === "B" && label === "Utilidad por visita" ? "font-semibold text-emerald-600" : ""}`}>{fmt(b)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="text-xs text-muted-foreground">{loading ? "Cargando…" : "Aún sin visitas en la prueba."}</p>
              )}
              <p className="text-xs text-muted-foreground">
                {winner ? (
                  <span className="flex items-center gap-1 font-medium text-emerald-700 dark:text-emerald-400">
                    <Trophy className="size-3.5" /> Va ganando el precio {winner}: deja más utilidad por cada visita.
                  </span>
                ) : (
                  `Espera al menos ${MIN_VISITS} visitas en cada versión y que se entreguen los pedidos antes de decidir: gana el que deja más utilidad por visita, no el que tiene más pedidos.`
                )}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => finish("A")} disabled={finishing}>
                  Quedarme con A
                </Button>
                <Button size="sm" onClick={() => finish("B")} disabled={finishing || !Object.keys(value.offers).length}>
                  {finishing ? <Loader2 className="animate-spin" /> : null} Quedarme con B
                </Button>
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
