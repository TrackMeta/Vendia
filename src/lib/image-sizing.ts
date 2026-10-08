/**
 * Tamaños de compresión de imágenes.
 * Las landings se ven en celular con un ancho máximo de 480 px CSS; a 2x de densidad
 * bastan ~1080 px de ancho. Se limita el ANCHO (no el lado más largo) para que las
 * imágenes verticales altas típicas de las landings COD no queden angostas.
 */

/** Ancho máximo por defecto para imágenes de landings y productos. */
export const DEFAULT_MAX_WIDTH = 1080;

/** Peso objetivo (MB) para una imagen de proporción "normal" (hasta 4:5) al ancho máximo. */
const BASE_TARGET_MB = 0.25;

/** Altura máxima absoluta (evita imágenes gigantes). */
const MAX_HEIGHT = 6000;

export type CompressionPlan = {
  /** Valor para browser-image-compression (limita el lado más largo). */
  maxWidthOrHeight: number;
  maxSizeMB: number;
};

/**
 * Calcula los parámetros de compresión para que el ANCHO final sea ≤ maxWidth,
 * y el peso objetivo crezca proporcionalmente con la altura de la imagen.
 */
export function compressionPlan(width: number, height: number, maxWidth = DEFAULT_MAX_WIDTH): CompressionPlan {
  if (!width || !height) return { maxWidthOrHeight: maxWidth, maxSizeMB: BASE_TARGET_MB };
  const targetWidth = Math.min(width, maxWidth);
  const targetHeight = Math.round((height / width) * targetWidth);
  const longest = Math.min(Math.max(targetWidth, targetHeight), MAX_HEIGHT);
  // Una imagen más alta que 4:5 tiene más píxeles: se le permite más peso, hasta 1 MB.
  const tallness = targetHeight / (targetWidth * 1.25);
  const sizeFactor = (targetWidth / DEFAULT_MAX_WIDTH) * Math.max(1, tallness);
  const maxSizeMB = Math.min(1, Math.max(0.05, Math.round(BASE_TARGET_MB * Math.max(sizeFactor, 0.2) * 100) / 100));
  return { maxWidthOrHeight: longest, maxSizeMB };
}
