/** Cada cuánto se leen las cuentas de Meta (lo elige el dueño en Marketing). */
export const SYNC_INTERVALS = {
  60: "Cada hora",
  120: "Cada 2 horas",
  180: "Cada 3 horas",
  360: "Cada 6 horas",
  720: "Cada 12 horas",
  1440: "Una vez al día",
} as const;
export type SyncInterval = keyof typeof SYNC_INTERVALS;
export const DEFAULT_SYNC_MINUTES: SyncInterval = 60;

/** Margen para que el reloj horario no se salte una tienda por segundos. */
export const TOLERANCE_MINUTES = 5;

export function parseSyncInterval(value: unknown): SyncInterval {
  const n = Number(value);
  return n in SYNC_INTERVALS ? (n as SyncInterval) : DEFAULT_SYNC_MINUTES;
}

/** ¿Le toca leer? La última lectura tiene más que su intervalo (con un pequeño margen). */
export function isSyncDue(lastSyncAt: string | null, everyMinutes: number, now = Date.now()): boolean {
  if (!lastSyncAt) return true;
  return now - Date.parse(lastSyncAt) >= (everyMinutes - TOLERANCE_MINUTES) * 60_000;
}
