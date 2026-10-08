import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";

const schema = z.object({ order_id: z.uuid(), landing_id: z.uuid() });

/**
 * Upsell de la página de gracias: agrega la oferta al MISMO pedido con un clic.
 * El precio sale de la landing publicada; solo una vez, en los primeros 30 minutos y antes de confirmar.
 * El id del pedido (UUID) solo lo conoce quien acaba de hacer el pedido.
 */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Solicitud inválida" }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Solicitud inválida" }, { status: 400 });

  const { data, error } = await createAdminClient().rpc("add_order_upsell", {
    p_order_id: parsed.data.order_id,
    p_landing_id: parsed.data.landing_id,
  });
  if (error) {
    const known = error.code === "P0001" || error.code === "P0002";
    return NextResponse.json({ error: known ? error.message : "No pudimos agregarlo. Escríbenos por WhatsApp." }, { status: known ? 400 : 500 });
  }
  const r = data as { total: number; added: number };
  return NextResponse.json({ total: Number(r.total), added: Number(r.added) });
}
