import { NextResponse, type NextRequest } from "next/server";
import { safeEqual } from "@/lib/crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { wwwCompanion } from "@/modules/domains";
import { removeVercelDomain } from "@/modules/domains/vercel";
import { retryMarketingEvents } from "@/modules/meta/capi";
import { syncAllMetaStores } from "@/modules/meta/sync";

export const maxDuration = 60;

/**
 * Tarea diaria (Vercel Cron, ver vercel.json; el plan Hobby solo permite crons diarios):
 * 1. Reintenta eventos de Conversions API fallidos (también hay un botón «Reintentar» en Marketing).
 * 2. Sincroniza campañas, gasto y métricas de Meta de las tiendas conectadas (últimos 3 días).
 * 3. Borra los formularios abandonados y los lotes exportados de más de 30 días.
 * 4. Borra los dominios propios que no se activaron en 7 días (y los quita de Vercel).
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
  // Formularios abandonados y lotes exportados: solo se guardan 30 días
  const { data: purged } = await admin.rpc("purge_abandoned_checkouts");
  const { data: batches } = await admin.rpc("purge_old_export_batches");
  // Dominios pendientes de más de 7 días: así nadie bloquea un dominio que no es suyo
  const { data: stale } = await admin.rpc("purge_stale_domains");
  const staleDomains = (stale ?? []) as string[];
  for (const domain of staleDomains) {
    await removeVercelDomain(domain);
    const www = wwwCompanion(domain);
    if (www) {
      const { data: own } = await admin.from("custom_domains").select("id").eq("domain", www).maybeSingle();
      if (!own) await removeVercelDomain(www);
    }
  }
  return NextResponse.json({ retry, sync, purged, batches, domains: staleDomains.length });
}
