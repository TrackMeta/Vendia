"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/** Oculta la guía de bienvenida (se puede volver a ver en Ayuda). */
export async function dismissWelcome() {
  const { store } = await requireOwner();
  const supabase = await createClient();
  await supabase.from("store_settings").update({ onboarding_dismissed: true }).eq("store_id", store.id);
  revalidatePath("/dashboard");
}

export async function showWelcome() {
  const { store } = await requireOwner();
  const supabase = await createClient();
  await supabase.from("store_settings").update({ onboarding_dismissed: false }).eq("store_id", store.id);
  revalidatePath("/dashboard");
}
