"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export type AuthState = { error?: string; message?: string } | undefined;

const emailSchema = z.email("Ingresa un correo válido").trim().toLowerCase();
const passwordSchema = z.string().min(8, "La contraseña debe tener al menos 8 caracteres").max(72);

async function origin() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? (host?.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

function safeNext(next: FormDataEntryValue | null): string {
  const value = typeof next === "string" ? next : "";
  return value.startsWith("/") && !value.startsWith("//") ? value : "/dashboard";
}

export async function login(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = z
    .object({ email: emailSchema, password: z.string().min(1, "Ingresa tu contraseña") })
    .safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    if (error.code === "email_not_confirmed") return { error: "Confirma tu correo antes de ingresar." };
    return { error: "Correo o contraseña incorrectos." };
  }
  redirect(safeNext(formData.get("next")));
}

export async function signup(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = z
    .object({
      fullName: z.string().trim().min(2, "Ingresa tu nombre").max(80),
      email: emailSchema,
      password: passwordSchema,
    })
    .safeParse({
      fullName: formData.get("fullName"),
      email: formData.get("email"),
      password: formData.get("password"),
    });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { full_name: parsed.data.fullName },
      emailRedirectTo: `${await origin()}/auth/callback?next=/onboarding`,
    },
  });
  if (error) {
    if (error.code === "user_already_exists") return { error: "Ya existe una cuenta con ese correo." };
    if (error.code === "weak_password") return { error: "Elige una contraseña más segura." };
    return { error: "No pudimos crear tu cuenta. Inténtalo de nuevo." };
  }
  if (data.session) redirect("/onboarding");
  return { message: "Te enviamos un correo para confirmar tu cuenta. Revisa tu bandeja de entrada." };
}

export async function requestPasswordReset(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = emailSchema.safeParse(formData.get("email"));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(parsed.data, {
    redirectTo: `${await origin()}/auth/callback?next=/nueva-clave`,
  });
  // Mismo mensaje exista o no la cuenta (no revelar correos registrados).
  return { message: "Si el correo está registrado, te enviamos un enlace para crear una nueva contraseña." };
}

export async function updatePassword(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = passwordSchema.safeParse(formData.get("password"));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  if (formData.get("password") !== formData.get("confirm")) return { error: "Las contraseñas no coinciden." };

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data });
  if (error) return { error: "El enlace expiró. Solicita uno nuevo." };
  redirect("/dashboard");
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
