import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { looksLikeBot, trippedTrap } from "@/lib/bot-guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizePeruPhone } from "@/lib/format";
import { allowRequest, requestIp } from "@/lib/rate-limit";

const schema = z.object({
  landing_page_id: z.uuid(),
  session_id: z.string().regex(/^[A-Za-z0-9]{8,64}$/),
  name: z.string().trim().max(160).optional(),
  phone: z.string().max(20),
  email: z.string().trim().max(200).optional(),
  district_code: z
    .string()
    .regex(/^\d{6}$/)
    .optional(),
  offer_id: z.uuid().optional(),
  // Trampa invisible (ver bot-guard)
  hp: z.string().max(200).optional(),
});

/**
 * Formulario abandonado: la landing lo manda (sendBeacon) cuando el cliente dejó su celular
 * pero no terminó el pedido. Solo se guarda para landings publicadas y si ese celular no pidió hace poco.
 * Lo que parece robot se ignora en silencio (204), y la base pone tope por celular y por tienda al día.
 */
export async function POST(request: NextRequest) {
  // Una persona real deja pocos carritos por minuto: corta el relleno con celulares falsos
  if (!allowRequest(`abandoned:${requestIp(request)}`, 10)) return new NextResponse(null, { status: 429 });
  if (looksLikeBot(request.headers.get("user-agent"))) return new NextResponse(null, { status: 204 });
  const raw = await request.text();
  if (raw.length > 4000) return new NextResponse(null, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return new NextResponse(null, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return new NextResponse(null, { status: 400 });
  const { hp, ...data } = parsed.data;
  if (trippedTrap(hp)) return new NextResponse(null, { status: 204 });
  const phone = normalizePeruPhone(data.phone);
  if (!phone) return new NextResponse(null, { status: 204 });

  const { error } = await createAdminClient().rpc("upsert_abandoned_checkout", { p: { ...data, phone } });
  if (error) console.error("upsert_abandoned_checkout", error.message);
  return new NextResponse(null, { status: 204 });
}
