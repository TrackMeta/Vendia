import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { createClient } from "@/lib/supabase/server";

const TYPES: EmailOtpType[] = ["signup", "email", "recovery", "invite", "magiclink", "email_change"];

/**
 * Enlaces de los correos de Supabase con token_hash (confirmar cuenta, nueva contraseña).
 * A diferencia de /auth/callback, funcionan aunque el correo se abra en otro aparato o navegador.
 * Plantillas en Supabase: {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/nueva-clave
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = safeRedirectPath(searchParams.get("next"), type === "recovery" ? "/nueva-clave" : "/onboarding");

  if (tokenHash && type && TYPES.includes(type)) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) return NextResponse.redirect(`${origin}${next}`);
  }

  return NextResponse.redirect(`${origin}/login?error=enlace`);
}
