/**
 * Búsqueda de pedidos (lista de Pedidos y buscador Ctrl+K): número, celular, nombre, DNI y
 * ubicación (departamento, provincia o distrito). Devuelve los filtros «or» de PostgREST.
 */
export function orderSearchFilters(query: string): string[] {
  // Fuera lo que rompe la sintaxis de PostgREST (comas, paréntesis, comodines, comillas)
  const text = query.replace(/[%_,()"\\*]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
  if (text.length < 2) return [];
  const digits = text.replace(/\D/g, "");
  const onlyDigits = /^#?\s*\d+$/.test(text);
  const filters: string[] = [];
  if (!onlyDigits) {
    filters.push(`customer_name.ilike.%${text}%`);
    if (text.length >= 3) {
      filters.push(`district_name.ilike.%${text}%`, `province_name.ilike.%${text}%`, `department_name.ilike.%${text}%`);
    }
  }
  if (digits.length >= 3) filters.push(`customer_phone.ilike.%${digits}%`);
  if (digits.length >= 4) filters.push(`dni.ilike.%${digits}%`);
  if (onlyDigits && digits.length <= 9) filters.push(`order_number.eq.${Number(digits)}`);
  return filters;
}
