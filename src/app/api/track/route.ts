import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";

const schema = z.object({
  landing_id: z.uuid(),
  event: z.enum(["page_view", "view_content", "initiate_checkout", "form_name", "form_phone", "form_location", "form_address", "form_submit"]),
  session_id: z.string().regex(/^[A-Za-z0-9]{8,64}$/),
  utm_source: z.string().max(255).optional(),
  utm_campaign: z.string().max(255).optional(),
  campaign_id: z.string().max(64).optional(),
  adset_id: z.string().max(64).optional(),
  ad_id: z.string().max(64).optional(),
  angle: z.string().trim().max(60).optional(),
  price_variant: z.enum(["A", "B"]).optional(),
});

/** Registra visitas de la landing para el funnel. Idempotente por sesión/día (en la BD). */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = JSON.parse(await request.text());
  } catch {
    return new NextResponse(null, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return new NextResponse(null, { status: 400 });

  const admin = createAdminClient();
  const base = {
    p_landing_id: parsed.data.landing_id,
    p_event: parsed.data.event,
    p_session: parsed.data.session_id,
    p_utm_source: parsed.data.utm_source ?? null,
    p_utm_campaign: parsed.data.utm_campaign ?? null,
    p_campaign_id: parsed.data.campaign_id ?? null,
  };
  // Con ángulo, versión de precio, conjunto y anuncio; si la base aún no conoce alguno, la visita se guarda sin él
  const extra = {
    ...(parsed.data.angle ? { p_angle: parsed.data.angle } : {}),
    ...(parsed.data.price_variant ? { p_price_variant: parsed.data.price_variant } : {}),
  };
  const ids = {
    ...(parsed.data.adset_id ? { p_adset_id: parsed.data.adset_id } : {}),
    ...(parsed.data.ad_id ? { p_ad_id: parsed.data.ad_id } : {}),
  };
  let { error } = await admin.rpc("track_landing_event", { ...base, ...extra, ...ids });
  if (error && Object.keys(ids).length) ({ error } = await admin.rpc("track_landing_event", { ...base, ...extra }));
  if (error && Object.keys(extra).length) ({ error } = await admin.rpc("track_landing_event", base));
  if (error) console.error("track_landing_event", error.message);
  return new NextResponse(null, { status: 204 });
}
