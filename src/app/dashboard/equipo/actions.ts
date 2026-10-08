"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type InviteResult = { ok: true; link: string } | { ok: false; error: string };
export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

async function origin() {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  return `${h.get("x-forwarded-proto") ?? (host?.startsWith("localhost") ? "http" : "https")}://${host}`;
}

export async function inviteMember(email: string): Promise<InviteResult> {
  const { store } = await requireOwner();
  const parsed = z.email("Correo inválido").trim().toLowerCase().safeParse(email);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_store_invitation", { p_store_id: store.id, p_email: parsed.data });
  if (error) return { ok: false, error: error.code === "P0001" ? error.message : "No se pudo crear la invitación" };
  revalidatePath("/dashboard/equipo");
  return { ok: true, link: `${await origin()}/invitacion/${data}` };
}

export async function removeMember(userId: string): Promise<ActionResult> {
  const { store } = await requireOwner();
  const supabase = await createClient();
  const { error } = await supabase.rpc("remove_store_member", { p_store_id: store.id, p_user_id: userId });
  if (error) return { ok: false, error: error.code === "P0001" ? error.message : "No se pudo quitar" };
  revalidatePath("/dashboard/equipo");
  return { ok: true, message: "Miembro quitado. Sus pedidos asignados quedaron libres." };
}

export async function revokeInvitation(invitationId: string): Promise<ActionResult> {
  await requireOwner();
  const supabase = await createClient();
  const { error } = await supabase.rpc("revoke_store_invitation", { p_invitation_id: invitationId });
  if (error) return { ok: false, error: "No se pudo anular la invitación" };
  revalidatePath("/dashboard/equipo");
  return { ok: true, message: "Invitación anulada" };
}
