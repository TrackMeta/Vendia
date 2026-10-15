import { Building2, Bus } from "lucide-react";

const ZONE_TONE = {
  lima: "border-teal-300 bg-teal-50 text-teal-800 dark:border-teal-800 dark:bg-teal-950/60 dark:text-teal-200",
  provincia: "border-fuchsia-300 bg-fuchsia-50 text-fuchsia-800 dark:border-fuchsia-800 dark:bg-fuchsia-950/60 dark:text-fuchsia-200",
} as const;

/** Lima / Provincia. Archivo aparte: Pedidos lo usa sin cargar la tabla de Logística ni el exportador. */
export function ZoneBadge({ zone }: { zone: "lima" | "provincia" }) {
  const Icon = zone === "lima" ? Building2 : Bus;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap ${ZONE_TONE[zone] ?? ZONE_TONE.provincia}`}>
      <Icon className="size-3" aria-hidden />
      {zone === "lima" ? "Lima" : "Provincia"}
    </span>
  );
}
