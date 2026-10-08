import { parseCsv } from "./csv";

/**
 * Importa el gasto desde un reporte exportado del Administrador de anuncios de Meta (CSV).
 * Recomendado: desglose por "Día" y nivel "Campaña", columnas "Identificador de la campaña"
 * e "Importe gastado". Soporta encabezados en español e inglés.
 */

export type ImportedExpense = {
  date: string; // YYYY-MM-DD
  campaignId: string | null;
  campaignName: string | null;
  amount: number;
  importKey: string;
};

export type ImportResult = { rows: ImportedExpense[]; warnings: string[]; errors: string[] };

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

function findColumn(headers: string[], candidates: string[]): number {
  const normalized = headers.map(norm);
  for (const c of candidates) {
    const index = normalized.findIndex((h) => h === c || h.startsWith(c));
    if (index !== -1) return index;
  }
  return -1;
}

/** "1,234.56" · "1.234,56" · "123.45" · "S/ 99" → número */
export function parseAmount(raw: string): number | null {
  let s = raw.replace(/[^\d.,-]/g, "");
  if (!s) return null;
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma > lastDot) s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(/,/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

/** "2026-10-01" · "01/10/2026" (día/mes/año) · "10/1/2026" no ambiguo → YYYY-MM-DD */
export function parseDate(raw: string): string | null {
  const s = raw.trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const [, a, b, y] = m;
    // Formato peruano: día/mes/año
    const day = Number(a);
    const month = Number(b);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  return null;
}

export function parseMetaAdsCsv(text: string): ImportResult {
  const warnings: string[] = [];
  const errors: string[] = [];
  const table = parseCsv(text);
  if (table.length < 2) return { rows: [], warnings, errors: ["El archivo está vacío o no tiene filas."] };

  const headers = table[0];
  const amountCol = findColumn(headers, ["importe gastado", "amount spent", "importe gastado (pen)", "gasto"]);
  const dayCol = findColumn(headers, ["dia", "day", "fecha"]);
  const startCol = findColumn(headers, ["inicio del informe", "reporting starts"]);
  const idCol = findColumn(headers, ["identificador de la campana", "id de la campana", "campaign id"]);
  const nameCol = findColumn(headers, ["nombre de la campana", "campaign name"]);

  if (amountCol === -1) errors.push('No encontramos la columna "Importe gastado" (Amount spent).');
  if (dayCol === -1 && startCol === -1) errors.push('No encontramos la columna "Día" (Day) ni "Inicio del informe".');
  if (errors.length) return { rows: [], warnings, errors };
  if (dayCol === -1) warnings.push('El reporte no tiene desglose por "Día": todo el gasto se asigna a la fecha de inicio del informe.');
  if (idCol === -1) warnings.push('El reporte no tiene "Identificador de la campaña": el CPA por campaña usará el nombre de la campaña.');

  const byKey = new Map<string, ImportedExpense>();
  table.slice(1).forEach((r, i) => {
    const amount = parseAmount(r[amountCol] ?? "");
    const date = parseDate(r[dayCol !== -1 ? dayCol : startCol] ?? "");
    const campaignId = idCol !== -1 ? (r[idCol] ?? "").trim() || null : null;
    const campaignName = nameCol !== -1 ? (r[nameCol] ?? "").trim() || null : null;
    if (!campaignId && !campaignName) return; // fila de totales
    if (amount === null || amount <= 0) return;
    if (!date) {
      warnings.push(`Fila ${i + 2}: fecha no reconocida, se omitió.`);
      return;
    }
    const key = `meta:${date}:${campaignId ?? campaignName}`;
    const existing = byKey.get(key);
    if (existing) existing.amount = Math.round((existing.amount + amount) * 100) / 100;
    else byKey.set(key, { date, campaignId, campaignName, amount, importKey: key });
  });

  const rows = [...byKey.values()].sort((a, b) => a.date.localeCompare(b.date));
  if (!rows.length) errors.push("No encontramos filas con gasto mayor a 0.");
  return { rows, warnings, errors };
}
