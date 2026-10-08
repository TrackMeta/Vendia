import { z } from "zod";
import { normalizePeruPhone } from "@/lib/format";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));

/**
 * Datos que envía el formulario COD. NO incluye precios: el servidor
 * los calcula desde la base de datos a partir de offer_id.
 */
export const orderInput = z.object({
  landing_page_id: z.uuid(),
  offer_id: z.uuid("Selecciona una oferta"),
  idempotency_key: z.string().min(8).max(100),
  first_name: z.string().trim().min(2, "Ingresa tu nombre").max(80),
  last_name: optionalText(80),
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
  whatsapp: optionalText(20),
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
    .max(200)
    .optional()
    .refine((v) => !v || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), "Revisa tu correo")
    .transform((v) => (v ? v : undefined)),
  district_code: z.string().regex(/^\d{6}$/, "Selecciona tu distrito"),
  address: z.string().trim().min(5, "Ingresa tu dirección completa").max(300),
  reference: optionalText(300),
  delivery_method: optionalText(60),
  notes: optionalText(500),
  /** IDs de los productos adicionales marcados (el precio lo pone el servidor). */
  bumps: z.array(z.string().min(1).max(40)).max(10).optional(),
  /** Campo trampa anti-bots: debe llegar vacío. */
  website: z.string().max(0).optional(),
  attribution: z
    .object({
      utm_source: optionalText(255),
      utm_medium: optionalText(255),
      utm_campaign: optionalText(255),
      utm_content: optionalText(255),
      utm_term: optionalText(255),
      fbclid: optionalText(512),
      fbc: optionalText(600),
      fbp: optionalText(255),
      ttclid: optionalText(500),
      ttp: optionalText(255),
      campaign_id: optionalText(64),
      adset_id: optionalText(64),
      ad_id: optionalText(64),
      referrer: optionalText(1000),
      landing_url: optionalText(2000),
    })
    .partial()
    .default({}),
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
