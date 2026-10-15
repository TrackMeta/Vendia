"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getMyStores, STORE_COOKIE } from "@/lib/auth";

/** Cambia la tienda activa (solo entre las tiendas a las que el usuario pertenece). */
export async function switchStore(storeId: string) {
  if (!z.uuid().safeParse(storeId).success) return;
  const store = (await getMyStores()).find((s) => s.id === storeId);
  if (!store) return;
  (await cookies()).set(STORE_COOKIE, store.id, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 365,
  });
  redirect(store.role === "owner" ? "/dashboard" : "/dashboard/pedidos");
}
