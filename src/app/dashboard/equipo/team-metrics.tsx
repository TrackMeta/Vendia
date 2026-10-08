import { formatNumber, formatPercent } from "@/lib/format";
import { safeDivide } from "@/modules/metrics";

export type TeamMetricRow = {
  user_id: string;
  name: string;
  color: string | null;
  role: "owner" | "staff";
  assigned: number;
  worked: number;
  confirmed: number;
  sales: number;
  failed: number;
  cancelled_after: number;
  first_response_minutes: number | null;
};

function minutes(m: number | null): string {
  if (m === null || m === undefined) return "—";
  if (m < 60) return `${Math.round(m)} min`;
  const h = m / 60;
  return h < 24 ? `${h.toFixed(1)} h` : `${(h / 24).toFixed(1)} d`;
}

/**
 * Métricas por confirmador, por cohorte (pedidos creados en el periodo):
 * conversión = confirmados ÷ trabajados · entrega = ventas reales ÷ confirmados · 1.ª respuesta = tiempo hasta el primer intento.
 */
export function TeamMetricsTable({ rows }: { rows: TeamMetricRow[] }) {
  if (!rows.length) return <p className="text-sm text-muted-foreground">Aún no hay datos en este periodo.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-xs text-muted-foreground">
          <tr className="border-b">
            <th className="py-2 text-left font-medium">Persona</th>
            <th className="py-2 text-right font-medium">Asignados</th>
            <th className="py-2 text-right font-medium" title="Pedidos que llamó, escribió o confirmó">
              Trabajados
            </th>
            <th className="py-2 text-right font-medium">Confirmados</th>
            <th className="py-2 text-right font-medium" title="Confirmados ÷ trabajados">
              % conversión
            </th>
            <th className="py-2 text-right font-medium">Ventas reales</th>
            <th className="py-2 text-right font-medium" title="Ventas reales ÷ confirmados">
              % entrega
            </th>
            <th className="py-2 text-right font-medium" title="Confirmados que no se entregaron, se devolvieron o se cancelaron después">
              Caídos
            </th>
            <th className="py-2 text-right font-medium" title="Tiempo promedio desde que llega el pedido hasta su primer intento de contacto">
              1.ª respuesta
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const conversion = safeDivide(r.confirmed, r.worked);
            const delivery = safeDivide(r.sales, r.confirmed);
            return (
              <tr key={r.user_id} className="border-b last:border-0">
                <td className="py-2">
                  <span className="flex items-center gap-2">
                    <span className="size-2.5 rounded-full" style={{ backgroundColor: r.color ?? "#9ca3af" }} />
                    {r.name}
                    {r.role === "owner" ? <span className="text-xs text-muted-foreground">(dueño)</span> : null}
                  </span>
                </td>
                <td className="py-2 text-right tabular-nums">{formatNumber(r.assigned)}</td>
                <td className="py-2 text-right tabular-nums">{formatNumber(r.worked)}</td>
                <td className="py-2 text-right font-medium tabular-nums">{formatNumber(r.confirmed)}</td>
                <td className="py-2 text-right tabular-nums">{formatPercent(conversion)}</td>
                <td className="py-2 text-right font-medium tabular-nums">{formatNumber(r.sales)}</td>
                <td className={`py-2 text-right tabular-nums ${delivery !== null && delivery < 0.6 ? "text-red-600" : ""}`}>{formatPercent(delivery)}</td>
                <td className="py-2 text-right tabular-nums">{formatNumber(r.failed + r.cancelled_after)}</td>
                <td className="py-2 text-right tabular-nums">{minutes(r.first_response_minutes)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
