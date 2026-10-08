/**
 * Controlador de pedidos: secuencia de contacto, resultados y motivos.
 * ESPEJO de los checks de supabase/migrations/20261008001200_order_controller.sql.
 */

export type ContactChannel = "call" | "whatsapp";

export const CONTACT_RESULTS = {
  confirmed: { label: "Confirmó", tone: "success" },
  no_answer: { label: "No contesta", tone: "neutral" },
  phone_off: { label: "Apagado / fuera de servicio", tone: "neutral" },
  call_later: { label: "Llamar después", tone: "info" },
  rejected: { label: "Rechazó / ya no lo quiere", tone: "danger" },
  wrong_number: { label: "Número equivocado", tone: "danger" },
  other: { label: "Otro", tone: "neutral" },
} as const;

export type ContactResult = keyof typeof CONTACT_RESULTS;

export const CANCEL_REASONS = {
  no_contesta: "No contesta",
  ya_no_lo_quiere: "Ya no lo quiere",
  precio: "Le pareció caro",
  pedido_duplicado: "Pedido duplicado",
  numero_equivocado: "Número equivocado",
  fuera_de_cobertura: "Fuera de cobertura",
  sin_adelanto: "No pagó el adelanto",
  pedido_falso: "Pedido falso / broma",
  otro: "Otro motivo",
} as const;

export type CancelReason = keyof typeof CANCEL_REASONS;

export const FAILURE_REASONS = {
  no_estaba: "No estaba en la dirección",
  rechazo_en_puerta: "Rechazó en la puerta",
  direccion_errada: "Dirección errada",
  no_pago_saldo: "No pagó el saldo (provincia)",
  no_recogio: "No recogió en agencia",
  cliente_cancelo: "Canceló después de confirmar",
  otro: "Otro motivo",
} as const;

export type FailureReason = keyof typeof FAILURE_REASONS;

export const RISK_LABELS: Record<string, string> = {
  historial_rechazos: "Rechazos previos",
  posible_duplicado: "Posible duplicado",
};

export const DEFAULT_SEQUENCE: ContactChannel[] = ["call", "call", "call", "whatsapp"];

/** Etiquetas de cada paso: ["Llamada 1", "Llamada 2", "Llamada 3", "WhatsApp"] */
export function sequenceLabels(sequence: ContactChannel[]): string[] {
  let calls = 0;
  let whatsapps = 0;
  const totalWhatsapp = sequence.filter((s) => s === "whatsapp").length;
  return sequence.map((step) => {
    if (step === "call") return `Llamada ${++calls}`;
    whatsapps++;
    return totalWhatsapp > 1 ? `WhatsApp ${whatsapps}` : "WhatsApp";
  });
}

/** Paso que toca ahora (0-based) o null si la secuencia terminó. */
export function nextStepIndex(attempts: number, sequence: ContactChannel[]): number | null {
  return attempts < sequence.length ? attempts : null;
}

/** Arma la secuencia desde la configuración simple: N llamadas + WhatsApp opcional al final. */
export function buildSequence(calls: number, whatsappAtEnd: boolean): ContactChannel[] {
  const n = Math.min(Math.max(Math.round(calls), 0), 6);
  const seq: ContactChannel[] = Array.from({ length: n }, () => "call");
  if (whatsappAtEnd) seq.push("whatsapp");
  return seq.length ? seq : ["call"];
}

/** Lima Metropolitana (1501) y Callao (0701) = "Lima"; el resto = "Provincia". */
export function zoneOf(provinceCode: string | null | undefined): "lima" | "provincia" {
  return provinceCode === "1501" || provinceCode === "0701" ? "lima" : "provincia";
}

/** Prioridad en la bandeja «Por confirmar»: primero los que toca llamar ya, luego los nuevos. */
export function confirmationPriority(o: { next_contact_at: string | null; contact_attempts: number; created_at: string }, now = Date.now()): number {
  if (o.next_contact_at && Date.parse(o.next_contact_at) <= now) return 0; // llamada pactada vencida
  if (o.contact_attempts === 0) return 1; // nuevo, nadie lo llamó
  if (o.next_contact_at) return 3; // pactado para más tarde
  return 2; // en secuencia
}

export function sortForConfirmation<T extends { next_contact_at: string | null; contact_attempts: number; created_at: string; last_contact_at?: string | null }>(
  orders: T[],
  now = Date.now(),
): T[] {
  return [...orders].sort((a, b) => {
    const pa = confirmationPriority(a, now);
    const pb = confirmationPriority(b, now);
    if (pa !== pb) return pa - pb;
    if (pa === 0 || pa === 3) return Date.parse(a.next_contact_at!) - Date.parse(b.next_contact_at!);
    const ta = Date.parse(a.last_contact_at ?? a.created_at);
    const tb = Date.parse(b.last_contact_at ?? b.created_at);
    return ta - tb;
  });
}
