import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * Prueba de precio: la versión B (precio de prueba) viaja como una ficha firmada
 * por el servidor. Así nadie puede pedir el precio B mandando "B" a mano.
 * Formato: "B.<firma base64url>". La versión A (precio normal) no necesita firma.
 */

function secret(): string {
  const own = process.env.PRICE_TEST_SECRET;
  if (own) return own;
  const base = process.env.SUPABASE_SECRET_KEY;
  if (!base) throw new Error("Falta PRICE_TEST_SECRET o SUPABASE_SECRET_KEY");
  // Derivada: nunca se usa ni se expone la clave de Supabase tal cual
  return createHash("sha256").update(`vendia-price-test:${base}`).digest("base64url");
}

function signature(landingId: string, key: string): string {
  return createHmac("sha256", key).update(`${landingId}:B`).digest("base64url");
}

/** Ficha de la versión B para esta landing (va en la cookie y en el pedido). */
export function signPriceVariantB(landingId: string, key: string = secret()): string {
  return `B.${signature(landingId, key)}`;
}

/** "B" solo si la ficha es la firmada para esta landing; cualquier otra cosa es "A" (precio normal). */
export function verifyPriceVariant(landingId: string, token: string | null | undefined, key?: string): "A" | "B" {
  if (!token || !token.startsWith("B.") || token.length > 200) return "A";
  try {
    const expected = Buffer.from(signature(landingId, key ?? secret()));
    const given = Buffer.from(token.slice(2));
    return given.length === expected.length && timingSafeEqual(given, expected) ? "B" : "A";
  } catch {
    return "A";
  }
}

/**
 * Lee la cookie guardada de la prueba de precio: "A", una ficha B válida, o null
 * (sin cookie, o una "B" vieja sin firma → se vuelve a sortear).
 */
export function savedPriceVariant(landingId: string, cookieValue: string | null | undefined, key?: string): "A" | "B" | null {
  if (cookieValue === "A") return "A";
  if (cookieValue?.startsWith("B.") && verifyPriceVariant(landingId, cookieValue, key) === "B") return "B";
  return null;
}
