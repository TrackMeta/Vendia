import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Cierra la sesión en este aparato y lleva al ingreso (enlace «¿No eres tú? Cerrar sesión»).
 * Solo si el pedido viene de Vendia: otra página (una imagen o un enlace escondido) no puede cerrarte la sesión.
 */
export async function GET(request: NextRequest) {
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" });
  return NextResponse.redirect(new URL("/login", request.url));
}
