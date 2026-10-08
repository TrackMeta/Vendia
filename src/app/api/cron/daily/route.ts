import { NextResponse, type NextRequest } from "next/server";
import { safeEqual } from "@/lib/crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { retryMarketingEvents } from "@/modules/meta/capi";
import { syncAllMetaStores } from "@/modules/meta/sync";

export const maxDuration = 60;

/**
 * Tarea diaria (Vercel Cron, ver vercel.json; el plan Hobby solo permite crons diarios):
 * 1. Reintenta eventos de Conversions API fallidos (también hay un botón «Reintentar» en Marketing).
 * 2. Sincroniza campañas, gasto y métricas de Meta de las tiendas conectadas (últimos 3 días).
 */
export async function GET(request: NextRequest) {
  const expected = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization") ?? "";
  if (!expected || !safeEqual(auth, `Bearer ${expected}`)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const admin = createAdminClient();
  const retry = await retryMarketingEvents(admin, 100);
  const sync = await syncAllMetaStores(admin);
  return NextResponse.json({ retry, sync });
}
