/**
 * Filtros silenciosos contra robots en lo que la landing manda sola (visitas y formularios abandonados).
 * Nunca se le muestra nada al cliente: si algo parece robot, simplemente no se guarda.
 * El pedido (/api/orders) NO pasa por aquí: un pedido real jamás se descarta por estos filtros.
 */

// Navegadores automáticos y rastreadores: una persona comprando nunca usa estos.
// Ojo: el navegador de Facebook/Instagram dice «FBAN»/«FBAV»/«Instagram», no «facebookexternalhit»,
// y hay celulares que se llaman «CUBOT»: por eso «bot» solo cuenta suelto o como «Algobot/1.0».
const BOT_UA = /\bbot\b|[a-z]bot\/|crawler|spider|slurp|headlesschrome|phantomjs|puppeteer|playwright|selenium|lighthouse|facebookexternalhit|python-requests|python-urllib|curl\/|wget\/|go-http-client|okhttp\/|java\//i;

export function looksLikeBot(userAgent: string | null | undefined): boolean {
  if (!userAgent || userAgent.length < 10) return true;
  return BOT_UA.test(userAgent);
}

/** Menos que esto entre abrir el formulario y dejar el celular: ninguna persona escribe tan rápido. */
export const MIN_FILL_MS = 1500;

/**
 * Trampa del formulario: `hp` es un campo escondido que una persona no ve (y no llena);
 * `t` son los milisegundos desde que se abrió el formulario. Si no vienen (página abierta
 * antes de esta versión), se deja pasar.
 */
export function trippedTrap(hp: string | undefined, t: number | undefined): boolean {
  if (hp && hp.trim()) return true;
  return typeof t === "number" && t >= 0 && t < MIN_FILL_MS;
}
