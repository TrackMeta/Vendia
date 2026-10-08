import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

export type CurrentStore = {
  id: string;
  name: string;
  slug: string;
  status: "active" | "blocked";
  currency: string;
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

/** Tienda del usuario actual (o null si aún no la crea). */
export const getCurrentStore = cache(async (): Promise<CurrentStore | null> => {
  const user = await getUser();
  if (!user) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("store_members")
    .select("stores (id, name, slug, status, currency)")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();
  const store = (data?.stores ?? null) as unknown as CurrentStore | null;
  return store;
});

/** Exige sesión + tienda. Redirige a login u onboarding según corresponda. */
export async function requireStore() {
  const user = await requireUser();
  const store = await getCurrentStore();
  if (!store) redirect("/onboarding");
  return { user, store };
}
