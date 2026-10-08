"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { z } from "zod";
import { requireOwner } from "@/lib/auth";
import { encryptSecret } from "@/lib/crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { landingCacheTag } from "@/modules/landing/public-data";

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

const schema = z.object({
  pixel_code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{10,40}$/, "El Pixel code de TikTok son letras y números (ej. C4ABCD123...)")
    .or(z.literal(""))
    .transform((v) => v || null),
  token: z.string().trim().max(1000).optional(),
  clear_token: z.literal("on").optional(),
  test_event_code: z
    .string()
    .trim()
    .max(40)
    .optional()
    .transform((v) => v || null),
  enabled: z.literal("on").optional(),
  send_lead: z.literal("on").optional(),
  send_purchase: z.literal("on").optional(),
});

/** Guarda la configuración de TikTok. El token se cifra y nunca vuelve al navegador. */
export async function saveTikTokSettings(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  const { store } = await requireOwner();
  const parsed = schema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const d = parsed.data;
  if (d.enabled && !d.pixel_code) return { ok: false, error: "Para activar TikTok necesitas el Pixel code" };

  const row: Record<string, unknown> = {
    store_id: store.id,
    pixel_code: d.pixel_code,
    test_event_code: d.test_event_code,
    enabled: Boolean(d.enabled),
    send_lead: Boolean(d.send_lead),
    send_purchase: Boolean(d.send_purchase),
  };
  if (d.token) {
    if (d.token.length < 20) return { ok: false, error: "El token de TikTok parece incompleto" };
    row.access_token_encrypted = encryptSecret(d.token);
  } else if (d.clear_token) {
    row.access_token_encrypted = null;
  }

  const admin = createAdminClient();
  const { error } = await admin.from("store_tiktok_settings").upsert(row, { onConflict: "store_id" });
  if (error) return { ok: false, error: "No se pudo guardar la configuración de TikTok" };

  const { data: landings } = await admin.from("landing_pages").select("slug").eq("store_id", store.id);
  for (const l of landings ?? []) revalidateTag(landingCacheTag(store.slug, l.slug), { expire: 0 });
  revalidatePath("/dashboard/marketing");
  return { ok: true, message: "Configuración de TikTok guardada" };
}
