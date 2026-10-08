"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { COURIER_IDS, COURIERS, SHALOM_ORIGINS } from "@/modules/couriers";
import { buildSequence } from "@/modules/orders/contact";

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : null));

const settingsSchema = z.object({
  name: z.string().trim().min(2, "El nombre de la tienda es muy corto").max(80),
  whatsapp: optional(20).refine((v) => !v || /^\+?\d[\d ]{7,18}$/.test(v), "WhatsApp inválido"),
  phone: optional(20),
  email: z
    .union([z.literal(""), z.email("Correo inválido")])
    .optional()
    .transform((v) => (v ? v : null)),
  address: optional(300),
  logo_path: optional(500),
  favicon_path: optional(500),
  shipping_lima: z.coerce.number().min(0).max(10_000),
  shipping_province: z.coerce.number().min(0).max(10_000),
  advance_amount: z.coerce.number().min(0).max(10_000),
  payment_methods: z
    .string()
    .max(300)
    .transform((v) =>
      v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 10),
    ),
  confirmation_message: z.string().trim().min(1, "Escribe un mensaje de confirmación").max(1000),
  purchase_trigger_status: z.enum(["confirmed", "shipped", "delivered", "collected"]),
  contact_calls: z.coerce.number().int().min(0).max(6),
  contact_whatsapp: z.literal("on").optional(),
});

export async function saveSettings(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  const { store } = await requireOwner();
  const parsed = settingsSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { name, contact_calls, contact_whatsapp, ...rest } = parsed.data;
  const settings = { ...rest, contact_sequence: buildSequence(contact_calls, Boolean(contact_whatsapp)) };

  for (const path of [settings.logo_path, settings.favicon_path]) {
    if (path && !path.startsWith(`${store.id}/`)) return { ok: false, error: "Imagen inválida" };
  }

  const supabase = await createClient();
  const [storeResult, settingsResult] = await Promise.all([
    supabase.from("stores").update({ name }).eq("id", store.id),
    supabase.from("store_settings").update(settings).eq("store_id", store.id),
  ]);
  if (storeResult.error || settingsResult.error) return { ok: false, error: "No se pudo guardar la configuración" };

  revalidatePath("/dashboard", "layout");
  return { ok: true, message: "Configuración guardada. Los cambios en landings publicadas se ven en unos minutos." };
}

// ─────────────────────────────────────────────────────────────────────
// Couriers de la tienda
// ─────────────────────────────────────────────────────────────────────

const courierSchema = z.object({
  courier_id: z.enum(COURIER_IDS as [string, ...string[]]),
  enabled: z.boolean(),
  is_default: z.boolean(),
  shipping_cost: z.coerce.number().min(0).max(10_000),
  return_shipments: z.coerce.number().int().min(0).max(2),
  origin_agency: z
    .string()
    .trim()
    .max(120)
    .refine((v) => !v || SHALOM_ORIGINS.includes(v), "Elige una agencia de origen de la lista de Shalom")
    .transform((v) => v || null),
});

export type CourierSettingsInput = z.input<typeof courierSchema>;

/** Activa/configura un courier: costo sugerido, costo de devolución y agencia de origen. */
export async function saveCourierSettings(input: CourierSettingsInput): Promise<ActionResult> {
  const { store } = await requireOwner();
  const parsed = courierSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  const d = parsed.data;
  const def = COURIERS[d.courier_id];
  if (def.status !== "ready" && d.enabled) return { ok: false, error: `${def.name} estará disponible próximamente` };

  const supabase = await createClient();
  // Un solo predeterminado por zona
  if (d.is_default) {
    await supabase.from("store_couriers").update({ is_default: false }).eq("store_id", store.id).eq("zone", def.zone).neq("courier_id", d.courier_id);
  }
  const values = { ...d, zone: def.zone, is_default: d.is_default && d.enabled };
  const { data: existing } = await supabase.from("store_couriers").select("courier_id").eq("store_id", store.id).eq("courier_id", d.courier_id).maybeSingle();
  const { error } = existing
    ? await supabase.from("store_couriers").update(values).eq("store_id", store.id).eq("courier_id", d.courier_id)
    : await supabase.from("store_couriers").insert({ ...values, store_id: store.id });
  if (error) return { ok: false, error: "No se pudo guardar el courier" };
  revalidatePath("/dashboard/configuracion");
  revalidatePath("/dashboard/logistica");
  return { ok: true, message: `${def.name} guardado` };
}
