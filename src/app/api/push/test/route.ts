import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { pushTest } from "@/modules/push/notify";

/** «Mandarme un aviso de prueba» desde la app (con la sesión de la persona). */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Inicia sesión" }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { token?: unknown };
  const token = typeof body.token === "string" && body.token.length <= 4096 ? body.token : undefined;
  return NextResponse.json(await pushTest(createAdminClient(), user.id, token));
}
