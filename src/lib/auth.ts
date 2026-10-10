import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { publicAssetUrl } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export type StoreRole = "owner" | "staff";

export type CurrentStore = {
  id: string;
  name: string;
  slug: string;
  status: "active" | "blocked";
  currency: string;
  country: string;
  /** owner = dueño (todo) · staff = Confirmador (pedidos, logística, clientes) */
  role: StoreRole;
  /** URL pública del logo (Configuración) o null. */
  logo: string | null;
};

/** Cookie con la tienda elegida en el selector. Solo es una preferencia: el acceso lo decide store_members (RLS). */
export const STORE_COOKIE = "vd_store";

export type SessionUser = { id: string; email: string | null };

/**
 * Usuario autenticado o null. getClaims verifica la firma del token aquí mismo (claves ES256
 * publicadas por Supabase), sin ir al servidor de Auth en cada página: una consulta menos por clic.
 * La base igual valida el token en cada consulta (RLS).
 */
export const getUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (error || !claims?.sub || claims.role !== "authenticated") return null;
  return { id: claims.sub, email: typeof claims.email === "string" ? claims.email : null };
});

export async function requireUser() {
  const user = await getUser();
  if (!user) redirect("/login");
  return user;
}

/** Todas las tiendas a las que pertenece el usuario (propias y donde es Confirmador). */
export const getMyStores = cache(async (): Promise<CurrentStore[]> => {
  const user = await getUser();
  if (!user) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("store_members")
    .select("role, created_at, stores (id, name, slug, status, currency, country, store_settings (logo_path))")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });
  type Settings = { logo_path: string | null } | { logo_path: string | null }[] | null;
  type Row = Omit<CurrentStore, "role" | "logo"> & { store_settings: Settings };
  const rows = (data ?? []) as unknown as { role: StoreRole; stores: Row | Row[] | null }[];
  return rows.flatMap((r) => {
    const raw = Array.isArray(r.stores) ? r.stores[0] : r.stores;
    if (!raw) return [];
    const { store_settings, ...store } = raw;
    const settings = Array.isArray(store_settings) ? store_settings[0] : store_settings;
    return [{ ...store, role: r.role, logo: publicAssetUrl(settings?.logo_path) }];
  });
});

/** Tienda activa: la elegida en el selector o, si no, la primera propia. Null si aún no tiene. */
export const getCurrentStore = cache(async (): Promise<CurrentStore | null> => {
  const stores = await getMyStores();
  if (!stores.length) return null;
  const chosen = (await cookies()).get(STORE_COOKIE)?.value;
  return stores.find((s) => s.id === chosen) ?? stores.find((s) => s.role === "owner") ?? stores[0];
});

/** Exige sesión + tienda. Redirige a login u onboarding según corresponda. */
export async function requireStore() {
  const user = await requireUser();
  const store = await getCurrentStore();
  if (!store) redirect("/onboarding");
  return { user, store };
}

/** Exige ser DUEÑO de la tienda (gastos, configuración, catálogo, Meta). */
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
