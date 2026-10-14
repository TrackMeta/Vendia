import { NextResponse, type NextRequest } from "next/server";
import { safeEqual } from "@/lib/crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { pushNotification } from "@/modules/push/notify";

export const maxDuration = 30;

/**
 * Aviso a la app de celular: lo llama la base (pg_net) cada vez que se crea una notificación,
 * con la llave «push_token» de public.app_internal que genera la propia base.
 */
export async function POST(request: NextRequest) {
  const admin = createAdminClient();
  const token = request.headers.get("x-push-token") ?? "";
  if (token.length < 32) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const { data } = await admin.from("app_internal").select("value").eq("key", "push_token").maybeSingle();
  if (!data?.value || !safeEqual(token, data.value as string)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { notification_id?: unknown };
  const id = typeof body.notification_id === "string" ? body.notification_id : "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Falta la notificación" }, { status: 400 });
  return NextResponse.json(await pushNotification(admin, id));
}
