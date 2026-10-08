/** Métodos de pago del adelanto y del saldo (mismo listado que el check de public.order_payments). */
export const PAYMENT_METHODS = {
  yape: "Yape",
  plin: "Plin",
  transferencia: "Transferencia",
  efectivo: "Efectivo",
  otro: "Otro",
} as const;

export type PaymentMethod = keyof typeof PAYMENT_METHODS;

export const PAYMENT_KINDS = { advance: "Adelanto", balance: "Pago del saldo" } as const;
export type PaymentKind = keyof typeof PAYMENT_KINDS;

/** Bucket privado de comprobantes. Ruta: {store_id}/{order_id}/archivo */
export const RECEIPTS_BUCKET = "order-receipts";

/** Lo pagado frente a lo que falta de un pedido. */
export function paymentSummary(total: number, payments: { kind: PaymentKind; amount: number }[]) {
  const advancePaid = payments.filter((p) => p.kind === "advance").reduce((s, p) => s + p.amount, 0);
  const balancePaid = payments.filter((p) => p.kind === "balance").reduce((s, p) => s + p.amount, 0);
  const paid = Math.round((advancePaid + balancePaid) * 100) / 100;
  return {
    advancePaid,
    balancePaid,
    paid,
    pending: Math.max(0, Math.round((total - paid) * 100) / 100),
    fullyPaid: paid >= total - 0.005,
  };
}
