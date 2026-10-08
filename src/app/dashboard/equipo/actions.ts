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

// ─────────────────────────────────────────────────────────────────────
// Color y comisión por persona · pagos de comisiones
// ─────────────────────────────────────────────────────────────────────

export async function updateMemberSettings(input: { userId: string; color: string; commissionLima: number; commissionProvince: number }): Promise<ActionResult> {
  const { store } = await requireOwner();
  const parsed = z
    .object({
      userId: z.uuid(),
      color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Color inválido"),
      commissionLima: z.coerce.number().min(0).max(10_000),
      commissionProvince: z.coerce.number().min(0).max(10_000),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const d = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_member_settings", {
    p_store_id: store.id,
    p_user_id: d.userId,
    p_color: d.color,
    p_commission_lima: d.commissionLima,
    p_commission_province: d.commissionProvince,
  });
  if (error) return { ok: false, error: "No se pudo guardar" };
  revalidatePath("/dashboard/equipo");
  return { ok: true, message: "Guardado. La comisión se aplica a los pedidos que confirme desde ahora." };
}

export async function addCommissionPayment(input: { userId: string; amount: number; paidOn: string; note?: string }): Promise<ActionResult> {
  const { store } = await requireOwner();
  const parsed = z
    .object({
      userId: z.uuid(),
      amount: z.coerce.number().positive("Ingresa el monto").max(1_000_000),
      paidOn: z.iso.date("Fecha inválida"),
      note: z.string().trim().max(300).optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const d = parsed.data;
  const supabase = await createClient();
  const { data: payment, error } = await supabase
    .from("commission_payments")
    .insert({ store_id: store.id, user_id: d.userId, amount: d.amount, paid_on: d.paidOn, note: d.note || null })
    .select("id")
    .single();
  if (error || !payment) return { ok: false, error: "No se pudo registrar el pago" };
  // También queda como gasto «Comisiones»: así se descuenta de tu utilidad real
  const { data: member } = await supabase.rpc("get_store_team", { p_store_id: store.id });
  const name = ((member ?? []) as { user_id: string; email: string; full_name: string | null }[]).find((m) => m.user_id === d.userId);
  await supabase.from("expenses").insert({
    store_id: store.id,
    expense_date: d.paidOn,
    category: "commissions",
    description: `Comisión · ${name?.full_name || name?.email || "equipo"}`.slice(0, 300),
    amount: d.amount,
    import_key: `commission:${payment.id}`,
  });
  revalidatePath("/dashboard/gastos");
  revalidatePath("/dashboard/equipo");
  return { ok: true, message: "Pago registrado" };
}

export async function deleteCommissionPayment(id: string): Promise<ActionResult> {
  const { store } = await requireOwner();
  if (!z.uuid().safeParse(id).success) return { ok: false, error: "Pago inválido" };
  const supabase = await createClient();
  const { error } = await supabase.from("commission_payments").delete().eq("id", id).eq("store_id", store.id);
  if (error) return { ok: false, error: "No se pudo eliminar" };
  await supabase.from("expenses").delete().eq("store_id", store.id).eq("import_key", `commission:${id}`);
  revalidatePath("/dashboard/gastos");
  revalidatePath("/dashboard/equipo");
  return { ok: true, message: "Pago eliminado" };
}
