"use server";

import { revalidatePath } from "next/cache";
import { requireStore } from "@/lib/auth";
import { encryptSecret, randomToken } from "@/lib/crypto";
import { createAdminClient } from "@/lib/supabase/admin";

export type SecretResult = { ok: true; secret: string } | { ok: false; error: string };
export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

/** Activa el webhook genérico (o rota su secreto). El secreto se muestra UNA sola vez. */
export async function enableGenericWebhook(): Promise<SecretResult> {
  const { store } = await requireStore();
  const secret = `whsec_${randomToken(24)}`;
  const admin = createAdminClient();
  const { error } = await admin.from("integrations").upsert(
    {
      store_id: store.id,
      provider: "generic_webhook",
      status: "active",
      webhook_secret_encrypted: encryptSecret(secret),
    },
    { onConflict: "store_id,provider" },
  );
  if (error) return { ok: false, error: "No se pudo activar el webhook" };
  await admin.from("integration_logs").insert({
    store_id: store.id,
    provider: "generic_webhook",
    direction: "outbound",
    operation: "rotate_secret",
    success: true,
    message: "Secreto generado",
  });
  revalidatePath("/dashboard/integraciones");
  return { ok: true, secret };
}

export async function disableIntegration(provider: string): Promise<ActionResult> {
  const { store } = await requireStore();
  const admin = createAdminClient();
  const { error } = await admin.from("integrations").update({ status: "disabled" }).eq("store_id", store.id).eq("provider", provider);
  if (error) return { ok: false, error: "No se pudo desactivar" };
  revalidatePath("/dashboard/integraciones");
  return { ok: true, message: "Integración desactivada" };
}
