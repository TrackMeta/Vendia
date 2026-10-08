import { z } from "zod";

const money = z.coerce.number({ error: "Ingresa un monto válido" }).min(0, "No puede ser negativo").max(1_000_000);
const optionalMoney = z
  .union([z.literal(""), z.coerce.number().min(0).max(1_000_000)])
  .optional()
  .transform((v) => (v === "" || v === undefined ? null : v));

export const productInput = z.object({
  name: z.string().trim().min(1, "Ingresa el nombre").max(160),
  sku: z
    .string()
    .trim()
    .max(64)
    .optional()
    .transform((v) => (v ? v : null)),
  description: z
    .string()
    .trim()
    .max(5000)
    .optional()
    .transform((v) => (v ? v : null)),
  price: money,
  compare_at_price: optionalMoney,
  cost: money,
  stock: z
    .union([z.literal(""), z.coerce.number().int().min(0)])
    .optional()
    .transform((v) => (v === "" || v === undefined ? null : v)),
  category: z
    .string()
    .trim()
    .max(80)
    .optional()
    .transform((v) => (v ? v : null)),
  status: z.enum(["draft", "active", "archived"]),
});

export type ProductInput = z.input<typeof productInput>;

export const offerInput = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(1, "Ponle nombre a la oferta").max(80),
  quantity: z.coerce.number().int().min(1).max(100),
  price: money,
  compare_at_price: optionalMoney,
  badge: z
    .string()
    .trim()
    .max(40)
    .optional()
    .transform((v) => (v ? v : null)),
  image_path: z.string().max(500).nullable().optional(),
  is_default: z.boolean(),
  is_active: z.boolean(),
});

export const offersInput = z
  .array(offerInput)
  .max(10)
  .refine((offers) => offers.filter((o) => o.is_default).length <= 1, "Solo una oferta puede ser la predeterminada");

export type OfferInput = z.input<typeof offerInput>;

export const PRODUCT_STATUS_LABELS = { draft: "Borrador", active: "Activo", archived: "Archivado" } as const;
