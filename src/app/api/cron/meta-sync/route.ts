import { NextResponse, type NextRequest } from "next/server";
import { safeEqual } from "@/lib/crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { syncDueMetaStores } from "@/modules/meta/sync";

export const maxDuration = 60;

/**
 * Reloj horario de Meta: lo llama Supabase (pg_cron + pg_net) cada hora con la llave de
 * public.app_internal («cron_token»), que genera la propia base. También acepta CRON_SECRET.
 * Lee solo las tiendas a las que ya les toca según lo que eligió cada dueño en Marketing.
 */
async function authorized(request: NextRequest, admin: ReturnType<typeof createAdminClient>): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization") ?? "";
  if (secret && safeEqual(auth, `Bearer ${secret}`)) return true;
  const token = request.headers.get("x-cron-token") ?? "";
  if (token.length < 32) return false;
  const { data } = await admin.from("app_internal").select("value").eq("key", "cron_token").maybeSingle();
  return Boolean(data?.value) && safeEqual(token, data!.value as string);
}

async function handle(request: NextRequest) {
  const admin = createAdminClient();
  if (!(await authorized(request, admin))) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const result = await syncDueMetaStores(admin);
  return NextResponse.json(result);
}

export const POST = handle;
export const GET = handle;
