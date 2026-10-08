export const EXPENSE_CATEGORIES = {
  meta_ads: "Meta Ads",
  tiktok_ads: "TikTok Ads",
  google_ads: "Google Ads",
  product: "Producto (compra de inventario)",
  courier: "Courier",
  shipping: "Envíos",
  returns: "Devoluciones",
  releasit: "Releasit",
  whatsapp: "WhatsApp",
  software: "Software",
  commissions: "Comisiones",
  other: "Otros",
} as const;

export type ExpenseCategory = keyof typeof EXPENSE_CATEGORIES;

export const AD_CATEGORIES: ExpenseCategory[] = ["meta_ads", "tiktok_ads", "google_ads"];

/**
 * Se registran como referencia de caja, pero NO se restan en la utilidad:
 * el costo de producto y de envío ya se toma de cada pedido (evita doble conteo).
 */
export const REFERENCE_ONLY_CATEGORIES: ExpenseCategory[] = ["product", "courier", "shipping"];
