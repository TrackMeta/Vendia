import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

export type StoreRole = "owner" | "staff";

export type CurrentStore = {
  id: string;
  name: string;
  slug: string;
  status: "active" | "blocked";
  currency: string;
  /** owner = dueño (todo) · staff = Confirmador (pedidos, logística, clientes) */
  role: StoreRole;
};

/** Usuario autenticado (verificado con el servidor de Auth) o null. */
export const getUser = cache(async () => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return data.user;
});

export async function requireUser() {
  const user = await getUser();
  if (!user) redirect("/login");
  return user;
}

/** Tienda del usuario actual (o null si aún no tiene). Prioriza la tienda propia. */
export const getCurrentStore = cache(async (): Promise<CurrentStore | null> => {
  const user = await getUser();
  if (!user) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("store_members")
    .select("role, created_at, stores (id, name, slug, status, currency)")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });
  const rows = (data ?? []) as unknown as { role: StoreRole; stores: Omit<CurrentStore, "role"> | Omit<CurrentStore, "role">[] | null }[];
  const pick = rows.find((r) => r.role === "owner") ?? rows[0];
  if (!pick?.stores) return null;
  const store = Array.isArray(pick.stores) ? pick.stores[0] : pick.stores;
  return store ? { ...store, role: pick.role } : null;
});

/** Exige sesión + tienda. Redirige a login u onboarding según corresponda. */
export async function requireStore() {
  const user = await requireUser();
  const store = await getCurrentStore();
  if (!store) redirect("/onboarding");
  return { user, store };
}

/** Exige ser DUEÑO de la tienda (gastos, configuración, catálogo, Meta, integraciones). */
export async function requireOwner() {
  const ctx = await requireStore();
  if (ctx.store.role !== "owner") redirect("/dashboard/pedidos?sinpermiso=1");
  return ctx;
}

/** Para Server Actions: devuelve error en vez de redirigir. */
export async function ownerOrError(): Promise<{ ok: true; user: Awaited<ReturnType<typeof requireStore>>["user"]; store: CurrentStore } | { ok: false; error: string }> {
  const ctx = await requireStore();
  if (ctx.store.role !== "owner") return { ok: false, error: "Solo el dueño de la tienda puede hacer esto" };
  return { ok: true, ...ctx };
}
