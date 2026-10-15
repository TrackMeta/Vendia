import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
import { channelForNotification } from "./channels";
import { sendPush, serviceAccountStatus } from "./fcm";

type Admin = ReturnType<typeof createAdminClient>;
type Device = { token: string; user_id: string; sound: string; sound_enabled: boolean; only_orders: boolean; muted_store_ids: string[] | null };

export type PushOutcome = { ok: boolean; sent: number; skipped?: string; removed?: number };

/** Pedidos por confirmar de la tienda: el número del ícono de la app. */
async function pendingOrders(admin: Admin, storeId: string): Promise<number> {
  const { count } = await admin.from("orders").select("id", { count: "exact", head: true }).eq("store_id", storeId).in("status", ["new", "pending_confirmation"]);
  return count ?? 0;
}

async function removeTokens(admin: Admin, tokens: string[]) {
  if (tokens.length) await admin.from("push_devices").delete().in("token", tokens);
}

/**
 * Aviso de una notificación de Vendia a los celulares del equipo de esa tienda
 * (cada uno con su sonido; nada a las tiendas que la persona silenció en ese celular).
 */
export async function pushNotification(admin: Admin, notificationId: string): Promise<PushOutcome> {
  const sa = serviceAccountStatus();
  if (typeof sa === "string") return { ok: false, sent: 0, skipped: sa };

  const { data: n } = await admin.from("notifications").select("id, store_id, type, title, body, link, order_id").eq("id", notificationId).maybeSingle();
  if (!n) return { ok: true, sent: 0, skipped: "no_existe" };

  const { data: members } = await admin.from("store_members").select("user_id").eq("store_id", n.store_id);
  const userIds = [...new Set((members ?? []).map((m) => m.user_id as string))];
  if (!userIds.length) return { ok: true, sent: 0, skipped: "sin_equipo" };

  const { data: devices } = await admin.from("push_devices").select("token, user_id, sound, sound_enabled, only_orders, muted_store_ids").in("user_id", userIds);
  const targets = ((devices ?? []) as Device[]).filter((d) => !(d.muted_store_ids ?? []).includes(n.store_id));
  if (!targets.length) return { ok: true, sent: 0, skipped: "sin_celulares" };

  // Con varias tiendas, el aviso dice de cuál es
  const [{ data: store }, { data: memberships }, badge] = await Promise.all([
    admin.from("stores").select("name").eq("id", n.store_id).maybeSingle(),
    admin.from("store_members").select("user_id").in("user_id", [...new Set(targets.map((d) => d.user_id))]),
    pendingOrders(admin, n.store_id),
  ]);
  const storesPerUser = new Map<string, number>();
  for (const m of memberships ?? []) storesPerUser.set(m.user_id as string, (storesPerUser.get(m.user_id as string) ?? 0) + 1);

  const link = n.link && n.link.startsWith("/") ? n.link : n.order_id ? `/dashboard/pedidos/${n.order_id}` : "/dashboard/pedidos";
  const invalid: string[] = [];
  let sent = 0;
  for (const d of targets) {
    const several = (storesPerUser.get(d.user_id) ?? 0) > 1;
    const result = await sendPush(sa, d.token, {
      title: several && store?.name ? `${store.name} · ${n.title}` : n.title,
      body: n.body || "Toca para verlo en Vendia",
      channel: channelForNotification(d, n.type),
      tag: n.order_id ?? n.id,
      count: n.type === "new_order" ? badge : undefined,
      data: { link, store_id: n.store_id, notification_id: n.id, type: n.type },
    }).catch(() => "error" as const);
    if (result === "ok") sent++;
    else if (result === "invalid") invalid.push(d.token);
  }
  await removeTokens(admin, invalid);
  return { ok: true, sent, removed: invalid.length };
}

/** «Mandarme un aviso de prueba»: a los celulares de esta persona (o solo a uno). */
export async function pushTest(admin: Admin, userId: string, onlyToken?: string): Promise<PushOutcome> {
  const sa = serviceAccountStatus();
  if (typeof sa === "string") return { ok: false, sent: 0, skipped: sa };
  let query = admin.from("push_devices").select("token, user_id, sound, sound_enabled, only_orders, muted_store_ids").eq("user_id", userId);
  if (onlyToken) query = query.eq("token", onlyToken);
  const { data: devices } = await query;
  if (!devices?.length) return { ok: false, sent: 0, skipped: "sin_celulares" };
  const invalid: string[] = [];
  let sent = 0;
  for (const d of devices as Device[]) {
    const result = await sendPush(sa, d.token, {
      title: "Aviso de prueba de Vendia",
      body: "Si ves esto, los avisos llegan a este celular aunque la app esté cerrada.",
      channel: channelForNotification(d, "new_order"),
      tag: "prueba",
      data: { link: "/dashboard/notificaciones" },
    }).catch(() => "error" as const);
    if (result === "ok") sent++;
    else if (result === "invalid") invalid.push(d.token);
  }
  await removeTokens(admin, invalid);
  return { ok: sent > 0, sent, removed: invalid.length };
}
