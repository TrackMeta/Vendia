import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";

const schema = z.object({
  landing_id: z.uuid(),
  event: z.enum(["page_view", "view_content", "initiate_checkout"]),
  session_id: z.string().regex(/^[A-Za-z0-9]{8,64}$/),
  utm_source: z.string().max(255).optional(),
  utm_campaign: z.string().max(255).optional(),
  campaign_id: z.string().max(64).optional(),
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

  const { error } = await createAdminClient().rpc("track_landing_event", {
    p_landing_id: parsed.data.landing_id,
    p_event: parsed.data.event,
    p_session: parsed.data.session_id,
    p_utm_source: parsed.data.utm_source ?? null,
    p_utm_campaign: parsed.data.utm_campaign ?? null,
    p_campaign_id: parsed.data.campaign_id ?? null,
  });
  if (error) console.error("track_landing_event", error.message);
  return new NextResponse(null, { status: 204 });
}
