import { z } from "zod";
import type { OrderStatus } from "@/modules/orders/state-machine";

/**
 * Webhook genérico de Vendia (para couriers, motorizados o automatizaciones).
 *
 * POST /api/webhooks/generic_webhook/{storeId}
 * Header:  x-vendia-signature: sha256=<HMAC-SHA256(secreto, cuerpo crudo) en hex>
 * Cuerpo:  {
 *   "event_id": "único por evento (idempotencia)",
 *   "order_number": 1001,            // o "external_order_id": "ABC-123"
 *   "status": "entregado",           // ver STATUS_ALIASES
 *   "note": "opcional",
 *   "tracking_code": "opcional",
 *   "courier_name": "opcional"
 * }
 */

export const STATUS_ALIASES: Record<string, OrderStatus> = {
  confirmed: "confirmed",
  confirmado: "confirmed",
  preparing: "preparing",
  preparando: "preparing",
  shipped: "shipped",
  enviado: "shipped",
  despachado: "shipped",
  out_for_delivery: "out_for_delivery",
  en_reparto: "out_for_delivery",
  en_ruta: "out_for_delivery",
  at_agency: "at_agency",
  en_agencia: "at_agency",
  llego_a_agencia: "at_agency",
  delivered: "delivered",
  entregado: "delivered",
  collected: "collected",
  cobrado: "collected",
  liquidado: "collected",
  cancelled: "cancelled",
  cancelado: "cancelled",
  failed_delivery: "failed_delivery",
  no_entregado: "failed_delivery",
  rechazado: "failed_delivery",
  returned: "returned",
  devuelto: "returned",
};

export function mapStatus(raw: string): OrderStatus | null {
  const key = raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  return STATUS_ALIASES[key] ?? null;
}

export const genericWebhookPayload = z
  .object({
    event_id: z.string().trim().min(1).max(200),
    order_number: z.coerce.number().int().positive().optional(),
    external_order_id: z.string().trim().min(1).max(120).optional(),
    status: z.string().min(1).max(40),
    note: z.string().max(500).optional(),
    tracking_code: z.string().max(120).optional(),
    courier_name: z.string().max(80).optional(),
  })
  .refine((p) => p.order_number !== undefined || p.external_order_id !== undefined, {
    message: "Envía order_number o external_order_id",
  });

/** Extrae la firma del header "sha256=<hex>" (o el hex directo). */
export function parseSignatureHeader(header: string | null): string | null {
  if (!header) return null;
  const value = header.trim().replace(/^sha256=/i, "");
  return /^[a-f0-9]{64}$/i.test(value) ? value.toLowerCase() : null;
}
