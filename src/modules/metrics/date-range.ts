/**
 * Rangos de fecha en hora de Lima (UTC−5, sin horario de verano).
 * Devuelven [from, to) en ISO UTC para filtrar en la base de datos.
 */
export const RANGE_PRESETS = {
  hoy: "Hoy",
  ayer: "Ayer",
  "7d": "Últimos 7 días",
  "30d": "Últimos 30 días",
  mes: "Este mes",
  "mes-anterior": "Mes anterior",
  personalizado: "Personalizado",
} as const;

export type RangePreset = keyof typeof RANGE_PRESETS;

const LIMA_OFFSET_HOURS = 5;

/** Fecha calendario (YYYY-MM-DD) de "ahora" en Lima. */
export function limaToday(now = new Date()): string {
  return new Date(now.getTime() - LIMA_OFFSET_HOURS * 3600_000).toISOString().slice(0, 10);
}

/** Medianoche de Lima de una fecha YYYY-MM-DD, como instante UTC. */
function limaMidnight(date: string): Date {
  return new Date(`${date}T0${LIMA_OFFSET_HOURS}:00:00.000Z`);
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

export type DateRange = { preset: RangePreset; from: string; to: string; label: string; startDate: string; endDate: string };

export function resolveRange(preset: string | undefined, desde?: string, hasta?: string, now = new Date()): DateRange {
  const today = limaToday(now);
  let start: string;
  let end: string; // inclusivo
  let p: RangePreset = (preset && preset in RANGE_PRESETS ? preset : "30d") as RangePreset;

  switch (p) {
    case "hoy":
      start = end = today;
      break;
    case "ayer":
      start = end = addDays(today, -1);
      break;
    case "7d":
      start = addDays(today, -6);
      end = today;
      break;
    case "mes":
      start = `${today.slice(0, 7)}-01`;
      end = today;
      break;
    case "mes-anterior": {
      const firstThisMonth = `${today.slice(0, 7)}-01`;
      end = addDays(firstThisMonth, -1);
      start = `${end.slice(0, 7)}-01`;
      break;
    }
    case "personalizado":
      if (isDate(desde) && isDate(hasta) && desde <= hasta) {
        start = desde;
        end = hasta;
        break;
      }
      p = "30d";
      start = addDays(today, -29);
      end = today;
      break;
    default:
      start = addDays(today, -29);
      end = today;
  }

  return {
    preset: p,
    from: limaMidnight(start).toISOString(),
    to: limaMidnight(addDays(end, 1)).toISOString(),
    label: p === "personalizado" ? `${start} → ${end}` : RANGE_PRESETS[p],
    startDate: start,
    endDate: end,
  };
}
