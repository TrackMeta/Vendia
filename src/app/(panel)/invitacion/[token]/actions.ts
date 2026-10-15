"use server";

import { cookies } from "next/headers";
import { requireUser, STORE_COOKIE } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export async function acceptInvitation(token: string): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireUser();
  if (!/^[a-f0-9]{24,128}$/.test(token)) return { ok: false, error: "Invitación no válida" };
  const supabase = await createClient();
  const { data: storeId, error } = await supabase.rpc("accept_store_invitation", { p_token: token });
  if (error) return { ok: false, error: error.code === "P0001" || error.code === "P0002" ? error.message : "No se pudo aceptar la invitación" };
  // Queda trabajando en la tienda que lo invitó (puede cambiar con el selector)
  if (typeof storeId === "string") {
    (await cookies()).set(STORE_COOKIE, storeId, { path: "/", httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 60 * 60 * 24 * 365 });
  }
  return { ok: true };
}
