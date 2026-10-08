"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

export async function setStoreStatus(storeId: string, status: "active" | "blocked"): Promise<ActionResult> {
  await requireUser();
  const parsed = z.object({ storeId: z.uuid(), status: z.enum(["active", "blocked"]) }).safeParse({ storeId, status });
  if (!parsed.success) return { ok: false, error: "Datos inválidos" };
  const supabase = await createClient();
  // La función verifica en la BD que el usuario sea administrador de la plataforma.
  const { error } = await supabase.rpc("admin_set_store_status", { p_store_id: storeId, p_status: status });
  if (error) return { ok: false, error: "Sin permiso o error al actualizar" };
  revalidatePath("/admin");
  return { ok: true, message: status === "blocked" ? "Tienda bloqueada" : "Tienda reactivada" };
}
