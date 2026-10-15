"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStore } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export async function markAbandoned(id: string, status: "contacted" | "dismissed"): Promise<{ ok: true } | { ok: false; error: string }> {
  const { store } = await requireStore();
  const parsed = z.object({ id: z.uuid(), status: z.enum(["contacted", "dismissed"]) }).safeParse({ id, status });
  if (!parsed.success) return { ok: false, error: "Datos inválidos" };
  const supabase = await createClient();
  const { error } = await supabase
    .from("abandoned_checkouts")
    .update({ status, ...(status === "contacted" ? { contacted_at: new Date().toISOString() } : {}) })
    .eq("id", id)
    .eq("store_id", store.id);
  if (error) return { ok: false, error: "No se pudo actualizar" };
  revalidatePath("/dashboard/abandonados");
  return { ok: true };
}
