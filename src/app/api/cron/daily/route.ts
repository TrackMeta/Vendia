import { NextResponse, type NextRequest } from "next/server";
import { safeEqual } from "@/lib/crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { wwwCompanion } from "@/modules/domains";
import { removeVercelDomain } from "@/modules/domains/vercel";
import { retryMarketingEvents } from "@/modules/meta/capi";
import { syncDueMetaStores } from "@/modules/meta/sync";

export const maxDuration = 60;

/**
 * Tarea diaria (Vercel Cron, ver vercel.json; el plan Hobby solo permite crons diarios).
 * Primero lo rápido e importante (la limpieza), después lo que puede tardar (Meta): así, aunque
 * haya muchas tiendas y se acabe el minuto, la limpieza siempre se hace.
 * 1. Borra los formularios abandonados y los lotes exportados de más de 30 días.
 * 2. Borra los dominios propios que no se activaron en 7 días (y los quita de Vercel).
 * 3. Reintenta eventos de Conversions API fallidos (también hay «Reintentar» en Marketing y en cada pedido).
 * 4. Respaldo de Meta: lee las tiendas a las que ya les toca, con el tiempo que quede
 *    (la lectura normal la hace el reloj horario /api/cron/meta-sync).
 */
export async function GET(request: NextRequest) {
  const started = Date.now();
  const expected = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization") ?? "";
  if (!expected || !safeEqual(auth, `Bearer ${expected}`)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const admin = createAdminClient();

  // 1. Formularios abandonados y lotes exportados: solo se guardan 30 días
  const { data: purged } = await admin.rpc("purge_abandoned_checkouts");
  const { data: batches } = await admin.rpc("purge_old_export_batches");

  // 2. Dominios pendientes de más de 7 días: así nadie bloquea un dominio que no es suyo
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

  // 3. Eventos de Meta que fallaron (pocos por vuelta: el resto, mañana o con «Reintentar»)
  const retry = await retryMarketingEvents(admin, 30);

  // 4. Meta, con el tiempo que quede (dejando margen para responder)
  const left = 50_000 - (Date.now() - started);
  const sync = left > 5_000 ? await syncDueMetaStores(admin, left) : { due: 0, synced: 0, skipped: "sin tiempo" };

  return NextResponse.json({ purged, batches, domains: staleDomains.length, retry, sync });
}
