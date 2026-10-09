"use server";

import { requireStore } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { OrderStatus } from "@/modules/orders/state-machine";

export type SearchOrder = { id: string; order_number: number; customer_name: string; customer_phone: string; status: OrderStatus; total: number };
export type SearchCustomer = { id: string; name: string; phone: string };
export type SearchResult = { orders: SearchOrder[]; customers: SearchCustomer[] };

/** Quita lo que rompe la sintaxis de filtros de PostgREST (comas, paréntesis, comodines, comillas). */
function clean(term: string) {
  return term.replace(/[%_,()"\\*]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Buscador rápido (Ctrl+K): pedidos por número, teléfono o nombre y clientes por teléfono o nombre.
 * Pensado para cuando un cliente llama: escribes su número y aparece su pedido.
 */
export async function quickSearch(query: string): Promise<SearchResult> {
  const { store } = await requireStore();
  const term = clean(String(query ?? "").slice(0, 60));
  if (term.length < 2) return { orders: [], customers: [] };
  const digits = term.replace(/\D/g, "");
  const isNumber = /^#?\s*\d+$/.test(term);

  const orderFilters = [`customer_name.ilike.%${term}%`];
  if (digits.length >= 3) orderFilters.push(`customer_phone.ilike.%${digits}%`);
  if (isNumber && digits.length <= 9) orderFilters.push(`order_number.eq.${Number(digits)}`);

  const customerFilters = [`first_name.ilike.%${term}%`, `last_name.ilike.%${term}%`];
  if (digits.length >= 3) customerFilters.push(`phone.ilike.%${digits}%`);

  const supabase = await createClient();
  const [{ data: orders }, { data: customers }] = await Promise.all([
    supabase
      .from("orders")
      .select("id, order_number, customer_name, customer_phone, status, total")
      .eq("store_id", store.id)
      .or(orderFilters.join(","))
      .order("created_at", { ascending: false })
      .limit(8),
    supabase.from("customers").select("id, first_name, last_name, phone").eq("store_id", store.id).or(customerFilters.join(",")).limit(5),
  ]);

  return {
    orders: (orders ?? []).map((o) => ({ ...o, total: Number(o.total) })) as SearchOrder[],
    customers: (customers ?? []).map((c) => ({ id: c.id, name: [c.first_name, c.last_name].filter(Boolean).join(" "), phone: c.phone })),
  };
}
