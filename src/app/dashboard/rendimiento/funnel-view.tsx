import { ArrowDown, TriangleAlert } from "lucide-react";
import { formatNumber, formatPercent } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { buildFunnel, type FunnelStep } from "@/modules/metrics";
import type { DateRange } from "@/modules/metrics/date-range";

/** Con menos de esto en la etapa anterior, un porcentaje no dice nada (3 visitas → 1 pedido no es tendencia). */
const MIN_FOR_INSIGHT = 10;

const ratio = (a: number, b: number) => (b > 0 ? a / b : null);

/** La caída más grande (en %) entre etapas con datos suficientes. Se ignora «vieron el producto» (depende del scroll). */
function worstDrop(steps: FunnelStep[]): string | null {
  let worst: { key: string; rate: number } | null = null;
  steps.forEach((s, i) => {
    if (i === 0 || s.key === "view_content" || s.rateFromPrevious === null) return;
    if (steps[i - 1].value < MIN_FOR_INSIGHT) return;
    if (!worst || s.rateFromPrevious < worst.rate) worst = { key: s.key, rate: s.rateFromPrevious };
  });
  return (worst as { key: string; rate: number } | null)?.key ?? null;
}

function Summary({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-2xl font-semibold tracking-tight tabular-nums">{value}</span>
      <span className="text-xs text-muted-foreground">{hint}</span>
    </div>
  );
}

/** Paso entre dos etapas: cuántos siguieron y cuántos se perdieron. La mayor caída se marca en ámbar. */
function Connector({ from, to, isWorst }: { from: FunnelStep; to: FunnelStep; isWorst: boolean }) {
  // En provincia se cobra antes de entregar: nunca mostramos más del 100 %
  const keptRaw = ratio(to.value, from.value);
  const kept = keptRaw === null ? null : Math.min(keptRaw, 1);
  const lost = Math.max(from.value - to.value, 0);
  return (
    <div className="flex justify-center py-1">
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs tabular-nums",
          isWorst ? "bg-amber-100 font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-100" : "text-muted-foreground",
        )}
      >
        {isWorst ? <TriangleAlert className="size-3.5" /> : <ArrowDown className="size-3.5" />}
        {kept === null ? "—" : `${formatPercent(kept, 0)} siguió`}
        {lost > 0 ? <span className="opacity-75">· se fueron {formatNumber(lost)}</span> : null}
        {isWorst ? <span>· mayor caída</span> : null}
      </span>
    </div>
  );
}

function StepRow({
  step,
  index,
  max,
  base,
  baseLabel,
  tone,
}: {
  step: FunnelStep;
  index: number;
  max: number;
  base: number;
  baseLabel: string;
  tone: "landing" | "after";
}) {
  const width = step.value ? Math.max((step.value / max) * 100, 3) : 0;
  const ofBase = ratio(step.value, base);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="flex items-center gap-2 text-sm">
          <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-medium text-muted-foreground">
            {index + 1}
          </span>
          {step.label}
        </span>
        <span className="flex items-baseline gap-2">
          {step.value !== base && ofBase !== null ? (
            <span className="text-xs text-muted-foreground tabular-nums">
              {formatPercent(Math.min(ofBase, 1), 1)} {baseLabel}
            </span>
          ) : null}
          <span className="text-lg font-semibold tabular-nums">{formatNumber(step.value)}</span>
        </span>
      </div>
      {/* Barra centrada: todas juntas dibujan la forma del embudo */}
      <div className="flex h-3 justify-center rounded-full bg-muted/60">
        <div
          className={cn("h-full rounded-full transition-all", tone === "landing" ? "bg-[#4c8df6]" : "bg-[#1a5fd1] dark:bg-[#6aa1f8]")}
          style={{ width: `${width}%` }}
        />
      </div>
    </div>
  );
}

/** Embudo: de la visita al pedido cobrado, en dos tramos (en la landing / después del pedido). */
export async function FunnelView({ storeId, range }: { storeId: string; range: DateRange }) {
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_funnel", { p_store_id: storeId, p_from: range.from, p_to: range.to });
  const steps = buildFunnel((data ?? {}) as Record<string, unknown>);
  const value = (key: string) => steps.find((s) => s.key === key)?.value ?? 0;
  const visits = value("visits");
  const orders = value("orders");
  const delivered = value("delivered");
  const worst = worstDrop(steps);
  const ordersIndex = steps.findIndex((s) => s.key === "orders");

  // Cada tramo con su propia escala y su referencia (visitas en la landing, pedidos después)
  const stage = (title: string, subtitle: string, from: number, to: number, tone: "landing" | "after") => {
    const slice = steps.slice(from, to);
    const max = Math.max(...slice.map((s) => s.value), 1);
    const base = slice[0].value;
    const baseLabel = tone === "landing" ? "de las visitas" : "de los pedidos";
    return (
      <section className="flex flex-col gap-1 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-medium">{title}</h2>
          <span className="text-xs text-muted-foreground">{subtitle}</span>
        </div>
        {slice.map((s, j) => {
          const i = from + j;
          return (
            <div key={s.key}>
              {j > 0 ? <Connector from={steps[i - 1]} to={s} isWorst={worst === s.key} /> : null}
              <StepRow step={s} index={i} max={max} base={base} baseLabel={baseLabel} tone={tone} />
            </div>
          );
        })}
      </section>
    );
  };

  if (!visits && !orders) {
    return (
      <p className="rounded-xl border border-dashed px-6 py-12 text-center text-sm text-muted-foreground">
        Aún no hay visitas en este periodo. Cuando alguien entre a tus landings, aquí verás en qué paso se quedan.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Summary
          label="De visita a pedido"
          value={formatPercent(ratio(orders, visits), 1)}
          hint={`${formatNumber(orders)} pedidos de ${formatNumber(visits)} visitas`}
        />
        <Summary
          label="De pedido a venta real"
          value={formatPercent(ratio(delivered, orders), 1)}
          hint={`${formatNumber(delivered)} entregados de ${formatNumber(orders)} pedidos`}
        />
        <Summary label="De visita a venta" value={formatPercent(ratio(delivered, visits), 1)} hint="La conversión completa de tu landing" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {stage("En tu landing", "Visitantes únicos por día", 0, ordersIndex + 1, "landing")}
        {/* «Pedidos» abre el segundo tramo: así se ve el paso pedidos → confirmados */}
        {stage("Después del pedido", "Pedidos del periodo y lo que lograron después", ordersIndex, steps.length, "after")}
      </div>

      {worst ? (
        <p className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <span>
            Donde más clientes pierdes es al pasar a <b>{steps.find((s) => s.key === worst)?.label}</b>. Mejora ese paso primero: es el que más plata te deja
            sobre la mesa.
          </span>
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">Cuando tengas al menos {MIN_FOR_INSIGHT} personas en cada paso te diremos dónde está la mayor caída.</p>
      )}
    </div>
  );
}
