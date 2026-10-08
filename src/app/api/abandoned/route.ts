import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizePeruPhone } from "@/lib/format";

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
});

/**
 * Formulario abandonado: la landing lo manda (sendBeacon) cuando el cliente dejó su celular
 * pero no terminó el pedido. Solo se guarda para landings publicadas y si ese celular no pidió hace poco.
 */
export async function POST(request: NextRequest) {
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
  const phone = normalizePeruPhone(parsed.data.phone);
  if (!phone) return new NextResponse(null, { status: 204 });

  const { error } = await createAdminClient().rpc("upsert_abandoned_checkout", { p: { ...parsed.data, phone } });
  if (error) console.error("upsert_abandoned_checkout", error.message);
  return new NextResponse(null, { status: 204 });
}
