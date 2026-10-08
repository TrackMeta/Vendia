import { NextResponse, type NextRequest } from "next/server";
import { safeEqual } from "@/lib/crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { retryMarketingEvents } from "@/modules/meta/capi";

/** Reintenta eventos de Conversions API fallidos. Lo llama Vercel Cron una vez al día (ver vercel.json; el plan Hobby solo permite crons diarios). También hay un botón «Reintentar» en Marketing. */
export async function GET(request: NextRequest) {
  const expected = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization") ?? "";
  if (!expected || !safeEqual(auth, `Bearer ${expected}`)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const result = await retryMarketingEvents(createAdminClient(), 100);
  return NextResponse.json(result);
}
