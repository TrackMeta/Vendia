import { after, NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { leadEventId } from "@/modules/meta/events";
import { enqueueOrderEvent } from "@/modules/meta/capi";
import { zoneOf } from "@/modules/orders/contact";
import { orderInput } from "@/modules/orders/order-input";

const RATE_LIMIT_WINDOW_MINUTES = 10;
const RATE_LIMIT_MAX_ORDERS = 5;

function clientIp(request: NextRequest): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || null;
  if (!ip) return null;
  // Validación básica IPv4/IPv6 antes de enviarla a la columna inet
  return /^[0-9a-fA-F:.]{3,45}$/.test(ip) ? ip : null;
}

/**
 * Crea un pedido COD desde la landing pública.
 * Precios, envío, ubicación e idempotencia se resuelven en create_cod_order().
 */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Solicitud inválida" }, { status: 400 });
  }

  const parsed = orderInput.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos" }, { status: 400 });
  }
  const input = parsed.data;
  // Provincia: el DNI es obligatorio (lo pide la agencia para entregar)
  if (zoneOf(input.district_code.slice(0, 4)) === "provincia" && !input.dni) {
    return NextResponse.json({ error: "Ingresa tu DNI (8 dígitos): lo pide la agencia para entregarte" }, { status: 400 });
  }
  const ip = clientIp(request);
  const supabase = createAdminClient();

  // Límite anti-spam por IP
  if (ip) {
    const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MINUTES * 60_000).toISOString();
    const { count } = await supabase
      .from("order_attribution")
      .select("order_id", { count: "exact", head: true })
      .eq("client_ip", ip)
      .gte("created_at", since);
    if ((count ?? 0) >= RATE_LIMIT_MAX_ORDERS) {
      return NextResponse.json(
        { error: "Recibimos varios pedidos desde tu conexión. Espera unos minutos o escríbenos por WhatsApp." },
        { status: 429 },
      );
    }
  }

  const { data, error } = await supabase.rpc("create_cod_order", {
    p: {
      landing_page_id: input.landing_page_id,
      offer_id: input.offer_id,
      idempotency_key: input.idempotency_key,
      first_name: input.first_name,
      last_name: input.last_name,
      phone: input.phone,
      whatsapp: input.whatsapp,
      dni: input.dni,
      district_code: input.district_code,
      address: input.address,
      reference: input.reference,
      delivery_method: input.delivery_method,
      notes: input.notes,
      attribution: input.attribution,
      client_ip: ip,
      user_agent: request.headers.get("user-agent")?.slice(0, 1000) ?? null,
    },
  });

  if (error) {
    if (error.code === "P0001" || error.code === "P0002") {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("create_cod_order", error);
    return NextResponse.json({ error: "No pudimos registrar tu pedido. Inténtalo de nuevo." }, { status: 500 });
  }

  const result = data as { order_id: string; order_number: number; total: number; duplicate_submit: boolean };

  // Lead por Conversions API (servidor) en segundo plano. Mismo event_id que el Pixel del navegador.
  if (!result.duplicate_submit) {
    after(async () => {
      try {
        await enqueueOrderEvent(supabase, result.order_id, "Lead");
      } catch (e) {
        console.error("CAPI Lead", e);
      }
    });
  }

  return NextResponse.json({
    orderNumber: result.order_number,
    total: Number(result.total),
    leadEventId: leadEventId(result.order_id),
  });
}
