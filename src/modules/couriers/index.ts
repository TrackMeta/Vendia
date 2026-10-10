/**
 * Catálogo de couriers y exportación a sus plantillas oficiales de carga masiva
 * (portado del kit de Nodo: docs/NODO-COURIERS.md).
 *
 * Para sumar otro courier: su plantilla en public/couriers/ + una entrada en COURIERS
 * con sus funciones `rows` y `review`.
 */
import { adjustTableRef, type Cell, entryByName, entryText, fillSheet, readZip, setEntryText, writeZip } from "./xlsx-fill";
import { itemLabel, type VariantBreakdown } from "@/modules/orders/items";
import lists from "./listas.json";

export type CourierZone = "lima" | "provincia";

/** Pedido en el formato que entienden las plantillas. */
export type CourierOrder = {
  orderNumber?: number;
  customer: string;
  phone: string;
  dni?: string | null;
  // Eva (Lima, contraentrega)
  district?: string | null;
  address?: string | null;
  reference?: string | null;
  /** Lo que el motorizado cobra en la puerta: total − adelanto. */
  amountToCollect?: number;
  description?: string;
  quantity?: number;
  /** Link de Google Maps o coordenadas (los agrega el equipo al trabajar el pedido). */
  location?: string | null;
  /** Nota del cliente para la entrega. */
  notes?: string | null;
  // Shalom (provincia, agencia)
  agency?: string | null;
  /** Lo que dijo el cliente (provincia/distrito); si no hay agencia se sugiere desde acá. */
  city?: string | null;
  packageSize?: string | null;
  height?: number;
  width?: number;
  length?: number;
  weight?: number;
};

export type ExportConfig = { originAgency?: string | null };

type CourierDef = {
  id: string;
  name: string;
  zone: CourierZone;
  /** ready = plantilla oficial lista · soon = próximamente */
  status: "ready" | "soon";
  template?: string;
  ext?: "xlsx" | "xlsm";
  sheet?: string;
  table?: string;
  color: string;
  rows?: (orders: CourierOrder[], cfg: ExportConfig) => Cell[][];
  review?: (orders: CourierOrder[], cfg: ExportConfig) => string[];
};

export const SHALOM_DESTINATIONS: string[] = lists.shalom.destino;
export const SHALOM_ORIGINS: string[] = lists.shalom.origen;
export const PACKAGE_SIZES: string[] = lists.shalom.mercaderia;
export const EVA_DISTRICTS: string[] = lists.eva.distrito;

/** Número para la celda, redondeado a 2 decimales. */
const N = (v: unknown): Cell => ({ t: "n", v: Math.round((Number(v) || 0) * 100) / 100 });
/** Los couriers piden el celular sin código de país (9 dígitos). */
export const phone9 = (t: unknown) => String(t ?? "").replace(/\D/g, "").slice(-9);
const qty = (o: CourierOrder) => (Number(o.quantity) > 1 ? Number(o.quantity) : 1);

/** Normaliza para comparar con las listas oficiales (sin tildes, sin «SHALOM», mayúsculas). */
export const norm = (s: unknown) =>
  String(s ?? "")
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\bSHALOM\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Sugiere la agencia oficial que más se parece a lo que dijo el cliente.
 * Si es ambiguo (Cusco tiene varias agencias) devuelve "" para que decida una persona.
 */
export function suggestAgency(text: string | null | undefined, agencies: string[] = SHALOM_DESTINATIONS): string {
  const t = norm(text);
  if (!t || !agencies.length) return "";
  const exact = agencies.find((a) => norm(a) === t);
  if (exact) return exact;
  const inside = agencies.filter((a) => {
    const na = norm(a);
    return na && t.includes(na);
  });
  if (inside.length) return inside.sort((a, b) => norm(b).length - norm(a).length)[0];
  const containing = agencies.filter((a) => {
    const na = norm(a);
    return na && na.includes(t);
  });
  if (containing.length === 1) return containing[0];
  if (containing.length > 1) return "";
  const tokens = new Set(t.split(" ").filter((w) => w.length > 2));
  if (!tokens.size) return "";
  let best = "";
  let score = 0;
  let tie = false;
  for (const a of agencies) {
    let sc = 0;
    for (const w of norm(a).split(" ")) if (w.length > 2 && tokens.has(w)) sc++;
    if (sc > score) {
      score = sc;
      best = a;
      tie = false;
    } else if (sc === score && sc > 0) tie = true;
  }
  return score > 0 && !tie ? best : "";
}

/** Agencias de destino que coinciden con un texto (para el buscador). */
export function searchAgencies(query: string, limit = 12, agencies: string[] = SHALOM_DESTINATIONS): string[] {
  const q = norm(query);
  if (!q) return [];
  const starts = agencies.filter((a) => norm(a).startsWith(q));
  const contains = agencies.filter((a) => !norm(a).startsWith(q) && norm(a).includes(q));
  return [...starts, ...contains].slice(0, limit);
}

/** Distrito de Eva equivalente al nombre del distrito INEI ("" si no está en su cobertura). */
export function evaDistrict(name: string | null | undefined): string {
  const n = norm(name);
  return EVA_DISTRICTS.find((d) => norm(d) === n) ?? "";
}

const label = (o: CourierOrder) => (o.orderNumber ? `#${o.orderNumber}` : o.customer || "Un pedido");

// ── Eva Courier (Lima, contraentrega) — hoja FORMULARIO ──
// A código de pedido · B destinatario · C celular · D distrito · E dirección · F referencia
// · G link de Maps o coordenadas · H método · I importe a cobrar · J observaciones · K descripción · L cantidad
function evaRows(orders: CourierOrder[]): Cell[][] {
  return orders.map((o) => {
    const f: Cell[] = [];
    // El número del pedido viaja a Eva: así cada entrega de su liquidación se cuadra con Vendia
    if (o.orderNumber) f[0] = String(o.orderNumber);
    f[1] = o.customer || "";
    f[2] = phone9(o.phone);
    f[3] = (evaDistrict(o.district) || String(o.district ?? "")).toUpperCase();
    f[4] = o.address || "";
    f[5] = o.reference || "";
    if (o.location) f[6] = o.location;
    f[7] = "EFECTIVO";
    f[8] = N(o.amountToCollect);
    if (o.notes) f[9] = o.notes.slice(0, 250);
    f[10] = String(o.description ?? "").slice(0, 250);
    f[11] = N(qty(o));
    return f;
  });
}

function evaReview(orders: CourierOrder[]): string[] {
  const out: string[] = [];
  for (const o of orders) {
    const q = label(o);
    if (!o.address) out.push(`${q}: falta la dirección.`);
    else if (/^https?:\/\//i.test(o.address.trim())) out.push(`${q}: la dirección es un enlace de mapa, no una dirección escrita.`);
    if (!o.district) out.push(`${q}: falta el distrito.`);
    else if (!evaDistrict(o.district)) out.push(`${q}: el distrito «${o.district}» no está en la cobertura de Eva.`);
    if (phone9(o.phone).length !== 9) out.push(`${q}: falta un celular válido de 9 dígitos.`);
  }
  return out;
}

// ── Shalom (provincia, recojo en agencia) — Hoja1 ──
// A DNI (texto) · B celular · F origen · G destino · H medida · I-L alto/ancho/largo/peso · M bultos
const shalomDestination = (o: CourierOrder) => (o.agency || suggestAgency(o.city) || "").trim().toUpperCase();

function shalomRows(orders: CourierOrder[], cfg: ExportConfig): Cell[][] {
  return orders.map((o) => {
    const f: Cell[] = [];
    f[0] = String(o.dni ?? "").trim(); // como TEXTO: conserva el 0 inicial
    f[1] = phone9(o.phone);
    f[5] = String(cfg.originAgency ?? "").toUpperCase();
    f[6] = shalomDestination(o);
    f[7] = String(o.packageSize || "PAQUETE S").toUpperCase();
    // Shalom exige un 0 explícito, no una celda vacía
    f[8] = N(o.height ?? 0);
    f[9] = N(o.width ?? 0);
    f[10] = N(o.length ?? 0);
    f[11] = N(o.weight ?? 1);
    f[12] = N(1);
    return f;
  });
}

function shalomReview(orders: CourierOrder[], cfg: ExportConfig): string[] {
  const out: string[] = [];
  const official = new Set(SHALOM_DESTINATIONS.map(norm));
  if (!cfg.originAgency) out.push("Elige la agencia Shalom de ORIGEN (desde donde despachas).");
  else if (!SHALOM_ORIGINS.some((a) => norm(a) === norm(cfg.originAgency))) out.push(`«${cfg.originAgency}» no es una agencia de origen de Shalom.`);
  for (const o of orders) {
    const q = label(o);
    if (!o.dni) out.push(`${q}: falta el DNI.`);
    else if (!/^\d{8}$/.test(String(o.dni).trim())) out.push(`${q}: el DNI «${o.dni}» no tiene 8 dígitos.`);
    const t = phone9(o.phone);
    if (t.length !== 9 || !t.startsWith("9")) out.push(`${q}: el celular no parece un móvil de 9 dígitos.`);
    const d = shalomDestination(o);
    if (!d) out.push(`${q}: falta la agencia de destino (la elige el cliente al confirmar).`);
    else if (!official.has(norm(d))) out.push(`${q}: «${d}» no es una agencia Shalom de la lista oficial.`);
    if (o.packageSize && !PACKAGE_SIZES.includes(o.packageSize.toUpperCase())) out.push(`${q}: la medida «${o.packageSize}» no existe en Shalom.`);
  }
  return out;
}

export const COURIERS: Record<string, CourierDef> = {
  eva: {
    id: "eva",
    name: "Eva Courier",
    zone: "lima",
    status: "ready",
    template: "eva.xlsm",
    ext: "xlsm",
    sheet: "xl/worksheets/sheet2.xml",
    table: "xl/tables/table2.xml",
    color: "#1f6feb",
    rows: evaRows,
    review: evaReview,
  },
  shalom: {
    id: "shalom",
    name: "Shalom",
    zone: "provincia",
    status: "ready",
    template: "shalom.xlsx",
    ext: "xlsx",
    sheet: "xl/worksheets/sheet1.xml",
    color: "#e2261c",
    rows: shalomRows,
    review: shalomReview,
  },
  olva: { id: "olva", name: "Olva Courier", zone: "provincia", status: "soon", color: "#f5a400" },
};

export const COURIER_IDS = Object.keys(COURIERS);
export const courierName = (id: string | null | undefined) => (id ? (COURIERS[id]?.name ?? id) : "—");

/** Avisos de datos que faltan ANTES de exportar (vacío = todo bien). */
export function reviewExport(courierId: string, orders: CourierOrder[], cfg: ExportConfig = {}): string[] {
  const c = COURIERS[courierId];
  if (!c?.review) return [`${c?.name ?? courierId}: todavía no tiene plantilla de carga masiva.`];
  return c.review(orders, cfg);
}

/** Genera el Excel rellenando la plantilla original (ArrayBuffer). */
export async function buildCourierFile(courierId: string, orders: CourierOrder[], template: ArrayBuffer, cfg: ExportConfig = {}) {
  const c = COURIERS[courierId];
  if (!c?.rows || !c.sheet) throw new Error(`${c?.name ?? courierId} todavía no tiene plantilla de carga masiva.`);
  const entries = readZip(template);
  const sheet = entryByName(entries, c.sheet);
  if (!sheet) throw new Error(`La plantilla de ${c.name} cambió de estructura.`);
  const rows = c.rows(orders, cfg);
  setEntryText(sheet, fillSheet(await entryText(sheet), rows, { headerRows: 1 }));
  if (c.table) {
    const t = entryByName(entries, c.table);
    if (t) setEntryText(t, adjustTableRef(await entryText(t), 1 + rows.length));
  }
  // Fecha de Lima (no UTC: de noche toISOString ya da «mañana»)
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" }).format(new Date());
  return { bytes: writeZip(entries), fileName: `${c.name.replace(/\s+/g, "_")}_por_enviar_${today}.${c.ext}`, rows: rows.length };
}

/** Pedido de Vendia (con su producto/oferta) → formato de la plantilla. */
export type VendiaExportOrder = {
  order_number: number;
  customer_name: string;
  customer_phone: string;
  dni: string | null;
  district_name: string;
  province_name: string;
  department_name: string;
  address: string;
  reference: string | null;
  balance_due: number | string;
  agency_destination: string | null;
  package_size: string | null;
  package_weight: number | string | null;
  customer_notes?: string | null;
  delivery_location?: string | null;
  items: {
    product_name: string;
    offer_name: string | null;
    quantity: number;
    variant_breakdown?: VariantBreakdown;
    product?: { package_size: string; package_weight: number | string; package_height: number | string; package_width: number | string; package_length: number | string } | null;
    offer?: { package_size: string | null; package_weight: number | string | null } | null;
  }[];
};

export function toCourierOrder(o: VendiaExportOrder): CourierOrder {
  const item = o.items[0];
  const product = item?.product ?? null;
  const offer = item?.offer ?? null;
  const num = (v: unknown) => (v === null || v === undefined || v === "" ? undefined : Number(v));
  return {
    orderNumber: o.order_number,
    customer: o.customer_name,
    phone: o.customer_phone,
    dni: o.dni,
    district: o.district_name,
    address: o.address,
    reference: o.reference,
    amountToCollect: Number(o.balance_due),
    description: o.items.map((i) => itemLabel(i)).join(" + "),
    location: o.delivery_location ?? null,
    notes: o.customer_notes ?? null,
    quantity: o.items.reduce((s, i) => s + i.quantity, 0),
    agency: o.agency_destination,
    city: o.district_name === o.province_name ? o.province_name : `${o.province_name} ${o.district_name}`,
    packageSize: o.package_size || offer?.package_size || product?.package_size || "PAQUETE S",
    weight: num(o.package_weight) ?? num(offer?.package_weight) ?? num(product?.package_weight) ?? 1,
    height: num(product?.package_height) ?? 0,
    width: num(product?.package_width) ?? 0,
    length: num(product?.package_length) ?? 0,
  };
}
