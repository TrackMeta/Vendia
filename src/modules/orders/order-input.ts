import { z } from "zod";
import { normalizePeruPhone } from "@/lib/format";
import { ATTRIBUTION_LIMITS } from "@/modules/attribution/limits";

/** Largo máximo de cada campo que escribe el cliente (el formulario usa los mismos en maxLength). */
export const ORDER_FIELD_LIMITS = {
  name: 80,
  fullName: 160,
  whatsapp: 20,
  email: 200,
  address: 300,
  reference: 300,
  notes: 500,
} as const;

const tooLong = (label: string, max: number) => `${label}: máximo ${max} caracteres`;

const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, tooLong(label, max))
    .optional()
    .transform((v) => (v ? v : undefined));

/** Dato de seguimiento: si viene más largo, se recorta (nunca bloquea el pedido). */
export const trackingText = (max: number) =>
  z
    .string()
    .optional()
    .transform((v) => {
      const t = v?.trim().slice(0, max).trim();
      return t ? t : undefined;
    });

const attributionShape = Object.fromEntries(
  Object.entries(ATTRIBUTION_LIMITS).map(([key, max]) => [key, trackingText(max)]),
) as { [K in keyof typeof ATTRIBUTION_LIMITS]: ReturnType<typeof trackingText> };

/**
 * Datos que envía el formulario COD. NO incluye precios: el servidor
 * los calcula desde la base de datos a partir de offer_id.
 */
export const orderInput = z.object({
  landing_page_id: z.uuid("Recarga la página e inténtalo de nuevo"),
  offer_id: z.uuid("Selecciona una oferta"),
  idempotency_key: z.string().min(8, "Recarga la página e inténtalo de nuevo").max(100, "Recarga la página e inténtalo de nuevo"),
  first_name: z.string().trim().min(2, "Ingresa tu nombre").max(ORDER_FIELD_LIMITS.name, tooLong("Nombre", ORDER_FIELD_LIMITS.name)),
  last_name: optionalText(ORDER_FIELD_LIMITS.name, "Apellido"),
  phone: z
    .string()
    .transform((v, ctx) => {
      const phone = normalizePeruPhone(v);
      if (!phone) {
        ctx.addIssue({ code: "custom", message: "Ingresa un celular válido de 9 dígitos" });
        return z.NEVER;
      }
      return phone;
    }),
  whatsapp: optionalText(ORDER_FIELD_LIMITS.whatsapp, "WhatsApp"),
  dni: z
    .string()
    .trim()
    .optional()
    .refine((v) => !v || /^\d{8}$/.test(v), "El DNI debe tener 8 dígitos")
    .transform((v) => (v ? v : undefined)),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(ORDER_FIELD_LIMITS.email, "Revisa tu correo")
    .optional()
    .refine((v) => !v || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), "Revisa tu correo")
    .transform((v) => (v ? v : undefined)),
  district_code: z.string().regex(/^\d{6}$/, "Selecciona tu distrito"),
  address: z
    .string()
    .trim()
    .min(5, "Ingresa tu dirección completa")
    .max(ORDER_FIELD_LIMITS.address, tooLong("Dirección", ORDER_FIELD_LIMITS.address)),
  reference: optionalText(ORDER_FIELD_LIMITS.reference, "Referencia"),
  delivery_method: trackingText(60),
  notes: optionalText(ORDER_FIELD_LIMITS.notes, "Observaciones"),
  /** Variante elegida por cada unidad del producto (talla, color…). */
  variants: z.array(z.uuid("Elige de nuevo la talla o variante")).max(100, "Demasiadas variantes").optional(),
  /** Ángulo de la landing que vio el cliente (para Rendimiento → Ángulos). */
  angle: trackingText(60),
  /**
   * Versión de la prueba de precio: ficha firmada por el servidor (ver price-test.ts).
   * Si no es válida el pedido va con el precio normal; nunca se rechaza por esto.
   */
  price_variant: z
    .string()
    .optional()
    .transform((v) => (v && v.length <= 200 ? v : undefined)),
  /** IDs de los productos adicionales marcados (el precio lo pone el servidor). */
  bumps: z.array(z.string().min(1).max(40)).max(10).optional(),
  /** Campo trampa anti-bots: debe llegar vacío. */
  website: z.string().max(0, "Solicitud inválida").optional(),
  attribution: z.object(attributionShape).partial().default({}),
});

export type OrderInput = z.input<typeof orderInput>;
export type ParsedOrderInput = z.output<typeof orderInput>;

/** Separa "Nombre completo" en nombre + apellido. */
export function splitFullName(fullName: string): { first_name: string; last_name?: string } {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length <= 1) return { first_name: parts[0] ?? "" };
  if (parts.length === 2) return { first_name: parts[0], last_name: parts[1] };
  // "María Fernanda Rojas Díaz" → nombres: primeras mitades
  const half = Math.ceil(parts.length / 2);
  return { first_name: parts.slice(0, half).join(" "), last_name: parts.slice(half).join(" ") };
}
