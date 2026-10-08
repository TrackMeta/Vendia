import { DEFAULT_COUNTRY, displayPhone, normalizePhone } from "@/modules/country";

const pen = new Intl.NumberFormat("es-PE", {
  style: "currency",
  currency: "PEN",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** S/ 1,234.50 — null/undefined se muestra como "—". */
export function formatMoney(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return "—";
  return pen.format(n).replace("PEN", "S/").replace(/ /g, " ");
}

export function formatPercent(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}

export function formatRatio(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${value.toFixed(2)}x`;
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("es-PE").format(value);
}

const dateTime = new Intl.DateTimeFormat("es-PE", {
  timeZone: "America/Lima",
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  return dateTime.format(typeof value === "string" ? new Date(value) : value);
}

const dateOnly = new Intl.DateTimeFormat("es-PE", { timeZone: "UTC", day: "2-digit", month: "short", year: "numeric" });

/** Fecha sin hora ("2026-10-08" → "08 oct. 2026"). Se interpreta como fecha de calendario, sin zona. */
export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? "—" : dateOnly.format(d);
}

/** Celular peruano → formato 51XXXXXXXXX. Devuelve null si no es válido. (Regla del país: src/modules/country) */
export function normalizePeruPhone(raw: string): string | null {
  return normalizePhone(raw, DEFAULT_COUNTRY);
}

/** 51987654321 → 987 654 321 */
export function displayPeruPhone(phone: string): string {
  return displayPhone(phone, DEFAULT_COUNTRY);
}

/** Texto → slug para URLs ("Faja Reductora Térmica" → "faja-reductora-termica"). */
export function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/** Relación "uno a uno" de Supabase: puede llegar como objeto o como lista de un elemento. */
export function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}
