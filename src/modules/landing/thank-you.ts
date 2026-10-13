/**
 * Mensaje de WhatsApp de la página de gracias. Se puede escribir con estas palabras
 * entre llaves y Vendia las reemplaza: {tienda}, {pedido} (ej: #1024) y {producto}.
 */
export const THANK_YOU_PLACEHOLDERS = ["{tienda}", "{pedido}", "{producto}"] as const;

export function fillThankYouMessage(template: string, data: { store: string; orderNumber: string | null; product: string }): string {
  return template
    .replaceAll("{tienda}", data.store)
    .replaceAll("{pedido}", data.orderNumber ? `#${data.orderNumber}` : "")
    .replaceAll("{producto}", data.product)
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ ([.,;:!?])/g, "$1")
    .trim();
}

/** Fondo suave del color de la oferta (para la tarjeta). */
export function softBackground(hex: string): string {
  return `color-mix(in srgb, ${hex} 8%, white)`;
}
