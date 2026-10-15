"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { createClient } from "@/lib/supabase/server";

export type AuthState = { error?: string; message?: string } | undefined;

const emailSchema = z.email("Ingresa un correo válido").trim().toLowerCase();
const passwordSchema = z.string().min(8, "La contraseña debe tener al menos 8 caracteres").max(72, "La contraseña puede tener hasta 72 caracteres");

/** Errores de envío de correos de Supabase, en palabras claras. */
function emailSendError(code: string | undefined): string | null {
  if (code === "over_email_send_rate_limit") return "Se enviaron muchos correos en poco tiempo. Espera unos minutos y vuelve a intentar.";
  if (code === "email_address_not_authorized") return "No pudimos enviarte el correo. Escríbenos y activamos tu cuenta.";
  return null;
}

/** Dirección de Vendia para los links de correo: la configurada (no la que diga el navegador). */
async function origin() {
  const site = process.env.NEXT_PUBLIC_SITE_URL;
  if (site) return site.replace(/\/+$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? (host?.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

function safeNext(next: FormDataEntryValue | null, fallback = "/dashboard"): string {
  return safeRedirectPath(next, fallback);
}

export async function login(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = z
    .object({ email: emailSchema, password: z.string().min(1, "Ingresa tu contraseña") })
    .safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    if (error.code === "email_not_confirmed") {
      // Le reenviamos el correo de confirmación (por si no le llegó o se venció)
      const { error: resendError } = await supabase.auth.resend({
        type: "signup",
        email: parsed.data.email,
        options: { emailRedirectTo: `${await origin()}/auth/callback?next=${encodeURIComponent(safeNext(formData.get("next"), "/onboarding"))}` },
      });
      return {
        error: resendError
          ? (emailSendError(resendError.code) ?? "Confirma tu correo antes de ingresar.")
          : "Falta confirmar tu correo: te reenviamos el enlace. Revisa tu bandeja de entrada (y la carpeta de spam).",
      };
    }
    if (error.code === "over_request_rate_limit") return { error: "Demasiados intentos. Espera un minuto y vuelve a intentar." };
    return { error: "Correo o contraseña incorrectos." };
  }
  redirect(safeNext(formData.get("next")));
}

export async function signup(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = z
    .object({
      fullName: z.string().trim().min(2, "Ingresa tu nombre").max(80, "El nombre puede tener hasta 80 caracteres"),
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
      emailRedirectTo: `${await origin()}/auth/callback?next=${encodeURIComponent(safeNext(formData.get("next"), "/onboarding"))}`,
    },
  });
  if (error) {
    if (error.code === "user_already_exists" || error.code === "email_exists") return { error: "Ya existe una cuenta con ese correo. Ingresa o recupera tu contraseña." };
    if (error.code === "weak_password") return { error: "La contraseña es muy débil: usa al menos 8 caracteres combinando letras y números." };
    return { error: emailSendError(error.code) ?? "No pudimos crear tu cuenta. Inténtalo de nuevo." };
  }
  if (data.session) redirect(safeNext(formData.get("next"), "/onboarding"));
  // Con «Confirmar correo» activo, un correo ya registrado no da error: vuelve sin identidades
  if (data.user && (data.user.identities ?? []).length === 0) {
    return { error: "Ya existe una cuenta con ese correo. Ingresa o recupera tu contraseña." };
  }
  return { message: "Te enviamos un correo para confirmar tu cuenta. Revisa tu bandeja de entrada (y la carpeta de spam)." };
}

export async function requestPasswordReset(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = emailSchema.safeParse(formData.get("email"));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data, {
    redirectTo: `${await origin()}/auth/callback?next=/nueva-clave`,
  });
  const sendError = emailSendError(error?.code);
  if (sendError) return { error: sendError };
  // Mismo mensaje exista o no la cuenta (no revelar correos registrados).
  return { message: "Si el correo está registrado, te enviamos un enlace para crear una nueva contraseña." };
}

export async function updatePassword(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = passwordSchema.safeParse(formData.get("password"));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  if (formData.get("password") !== formData.get("confirm")) return { error: "Las contraseñas no coinciden." };

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data });
  if (error) {
    if (error.code === "same_password") return { error: "La nueva contraseña debe ser distinta a la anterior." };
    if (error.code === "weak_password") return { error: "La contraseña es muy débil: usa al menos 8 caracteres combinando letras y números." };
    return { error: "El enlace expiró. Solicita uno nuevo." };
  }
  redirect("/dashboard");
}

/** Cerrar sesión y volver a ingresar con otra cuenta, regresando a «next» (p. ej. una invitación). */
export async function logoutAndContinue(formData: FormData) {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" });
  redirect(`/login?next=${encodeURIComponent(safeNext(formData.get("next")))}`);
}

export async function logout() {
  const supabase = await createClient();
  // Solo en este aparato: cerrar sesión en la computadora no debe sacarte de la app del celular
  await supabase.auth.signOut({ scope: "local" });
  redirect("/login");
}
