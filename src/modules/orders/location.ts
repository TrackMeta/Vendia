/**
 * Ubicación de entrega que agrega el equipo al trabajar el pedido (el cliente la manda por WhatsApp):
 * un link de mapas (Google Maps, Waze, Apple) o coordenadas «-12.0464, -77.0428».
 * Se exporta tal cual a la columna «LINK MAPS O COORDENADAS GPS» de Eva.
 */
const MAP_HOSTS = /(^|\.)(google\.[a-z.]+|goo\.gl|maps\.app\.goo\.gl|waze\.com|apple\.com)$/i;
const COORDS = /^(-?\d{1,2}(?:\.\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)$/;

export type LocationResult = { ok: true; value: string | null } | { ok: false; error: string };

/** Valida y limpia lo que pegó el usuario. Vacío = sin ubicación. */
export function parseDeliveryLocation(raw: string | null | undefined): LocationResult {
  const text = String(raw ?? "").trim();
  if (!text) return { ok: true, value: null };
  if (text.length > 500) return { ok: false, error: "La ubicación es demasiado larga" };

  const coords = COORDS.exec(text);
  if (coords) {
    const lat = Number(coords[1]);
    const lng = Number(coords[2]);
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return { ok: false, error: "Esas coordenadas no son válidas" };
    return { ok: true, value: `${lat}, ${lng}` };
  }

  // El link puede venir dentro de un texto copiado de WhatsApp: se toma el primer enlace
  const link = /https?:\/\/\S+/i.exec(text)?.[0];
  if (link) {
    try {
      const url = new URL(link);
      if (url.protocol === "https:" && MAP_HOSTS.test(url.hostname)) return { ok: true, value: url.toString() };
    } catch {
      // cae al error de abajo
    }
  }
  return { ok: false, error: "Pega un link de Google Maps (o Waze) o coordenadas como «-12.0464, -77.0428»" };
}

/** Link para abrir la ubicación en el mapa (las coordenadas se abren en Google Maps). */
export function mapsLink(location: string | null | undefined): string | null {
  if (!location) return null;
  const coords = COORDS.exec(location.trim());
  return coords ? `https://www.google.com/maps?q=${Number(coords[1])},${Number(coords[2])}` : location;
}
