/** Variantes de una línea del pedido: [{ variant_id, name, quantity }]. */
export type VariantBreakdown = { variant_id: string; name: string; quantity: number }[];

/** "M, L ×2" */
export function variantsLabel(breakdown: VariantBreakdown | null | undefined): string {
  return (breakdown ?? []).map((b) => (b.quantity > 1 ? `${b.name} ×${b.quantity}` : b.name)).join(", ");
}

/** "Faja (2 unidades) · M, L" — para listas, WhatsApp, planillas y rótulos. */
export function itemLabel(item: { product_name: string; offer_name?: string | null; variant_breakdown?: VariantBreakdown | null }): string {
  const variants = variantsLabel(item.variant_breakdown);
  return `${item.product_name}${item.offer_name ? ` (${item.offer_name})` : ""}${variants ? ` · ${variants}` : ""}`;
}
