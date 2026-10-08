"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type OnboardingState = { error?: string } | undefined;

const schema = z.object({
  name: z.string().trim().min(2, "El nombre debe tener al menos 2 caracteres").max(80),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(3, "El enlace debe tener al menos 3 caracteres")
    .max(40)
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Usa solo letras minúsculas, números y guiones"),
});

export async function createStore(_prev: OnboardingState, formData: FormData): Promise<OnboardingState> {
  await requireUser();
  const parsed = schema.safeParse({ name: formData.get("name"), slug: formData.get("slug") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const { error } = await supabase.rpc("create_store", { p_name: parsed.data.name, p_slug: parsed.data.slug });
  if (error) {
    if (error.code === "23505") return { error: "Ese enlace ya está en uso. Prueba con otro." };
    if (error.code === "P0001") return { error: error.message };
    return { error: "No pudimos crear tu tienda. Inténtalo de nuevo." };
  }
  redirect("/dashboard");
}
