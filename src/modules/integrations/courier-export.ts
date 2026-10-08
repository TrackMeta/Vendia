import { toCsv } from "@/modules/expenses/csv";

export type ExportableOrder = {
  order_number: number;
  created_at: string;
  customer_name: string;
  customer_phone: string;
  dni: string | null;
  department_name: string;
  province_name: string;
  district_name: string;
  district_code: string;
  address: string;
  reference: string | null;
  balance_due: number | string;
  total: number | string;
  customer_notes: string | null;
  items: { product_name: string; offer_name: string | null; quantity: number }[];
};

export const COURIER_COLUMNS = [
  "Pedido",
  "Fecha",
  "Cliente",
  "Celular",
  "DNI",
  "Departamento",
  "Provincia",
  "Distrito",
  "Ubigeo",
  "Dirección",
  "Referencia",
  "Producto",
  "Cantidad",
  "Monto a cobrar (S/)",
  "Total pedido (S/)",
  "Observaciones",
];

/** Planilla genérica para courier: una fila por pedido, monto a cobrar = saldo contraentrega. */
export function buildCourierCsv(orders: ExportableOrder[]): string {
  const rows = orders.map((o) => {
    const local = o.customer_phone.startsWith("51") ? o.customer_phone.slice(2) : o.customer_phone;
    return [
      o.order_number,
      o.created_at.slice(0, 10),
      o.customer_name,
      local,
      o.dni,
      o.department_name,
      o.province_name,
      o.district_name,
      o.district_code,
      o.address,
      o.reference,
      o.items.map((i) => `${i.product_name}${i.offer_name ? ` (${i.offer_name})` : ""}`).join(" + "),
      o.items.reduce((sum, i) => sum + i.quantity, 0),
      Number(o.balance_due).toFixed(2),
      Number(o.total).toFixed(2),
      o.customer_notes,
    ];
  });
  return toCsv([COURIER_COLUMNS, ...rows]);
}
