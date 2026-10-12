import type { NextRequest } from "next/server";

/**
 * Límite simple por IP para los endpoints públicos (visitas, carritos abandonados, errores).
 * Vive en la memoria de cada servidor: no es exacto, pero corta el abuso de un solo origen.
 */
const hits = new Map<string, number[]>();
const MAX_KEYS = 5000;

export function requestIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "desconocida";
}

/** true si todavía puede: como máximo `limit` llamadas por `windowMs` para esa clave. */
export function allowRequest(key: string, limit: number, windowMs = 60_000, now = Date.now()): boolean {
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > MAX_KEYS) {
    // Limpieza: se olvidan las claves más antiguas
    for (const k of [...hits.keys()].slice(0, hits.size - MAX_KEYS)) hits.delete(k);
  }
  return true;
}
