"use client";

import { BadgeCheck, FileText, Paperclip, Plus, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDate, formatMoney } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import { compressImage } from "@/lib/upload";
import { PAYMENT_KINDS, PAYMENT_METHODS, type PaymentKind, type PaymentMethod, paymentSummary, RECEIPTS_BUCKET } from "@/modules/orders/payments";
import { addOrderPayment, deleteOrderPayment, verifyOrderPayment } from "../actions";

export type PaymentRow = {
  id: string;
  kind: PaymentKind;
  amount: number;
  method: PaymentMethod;
  paid_on: string;
  note: string | null;
  receipt_url: string | null;
  receipt_is_pdf: boolean;
  verified: boolean;
  verified_by_name: string | null;
  created_by_name: string;
};

const selectClass = "h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm";

function limaToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" }).format(new Date());
}

/** Adelanto y pago del saldo, con comprobante (bucket privado: solo el equipo lo ve). */
export function PaymentsCard({
  storeId,
  orderId,
  zone,
  total,
  advanceExpected,
  payments,
}: {
  storeId: string;
  orderId: string;
  zone: "lima" | "provincia";
  total: number;
  advanceExpected: number;
  payments: PaymentRow[];
}) {
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const summary = paymentSummary(total, payments);
  const [kind, setKind] = useState<PaymentKind>(summary.advancePaid > 0 || zone === "lima" ? "balance" : "advance");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("yape");
  const [paidOn, setPaidOn] = useState(limaToday);
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const suggested = kind === "advance" ? Math.max(0, advanceExpected - summary.advancePaid) : summary.pending;

  const submit = () =>
    startTransition(async () => {
      let receiptPath: string | undefined;
      if (file) {
        try {
          const isPdf = file.type === "application/pdf";
          if (!isPdf && !file.type.startsWith("image/")) throw new Error("El comprobante debe ser una imagen o un PDF");
          if (file.size > 15 * 1024 * 1024) throw new Error("El archivo pesa más de 15 MB");
          const upload = isPdf ? file : await compressImage(file, 1600);
          if (upload.size > 5 * 1024 * 1024) throw new Error("El comprobante pesa más de 5 MB");
          const ext = isPdf ? "pdf" : upload.type === "image/webp" ? "webp" : "jpg";
          receiptPath = `${storeId}/${orderId}/${crypto.randomUUID()}.${ext}`;
          const { error } = await createClient().storage.from(RECEIPTS_BUCKET).upload(receiptPath, upload, { contentType: upload.type, upsert: false });
          if (error) throw new Error("No se pudo subir el comprobante");
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "No se pudo subir el comprobante");
          return;
        }
      }
      const r = await addOrderPayment({
        orderId,
        kind,
        amount: amount === "" ? suggested : Number(amount),
        method,
        paid_on: paidOn,
        note: note || undefined,
        receipt_path: receiptPath,
      });
      if (!r.ok) {
        toast.error(r.error);
        if (receiptPath) await createClient().storage.from(RECEIPTS_BUCKET).remove([receiptPath]);
        return;
      }
      toast.success(r.message ?? "Pago registrado");
      setOpen(false);
      setAmount("");
      setNote("");
      setFile(null);
    });

  const run = (fn: () => Promise<{ ok: boolean; message?: string; error?: string }>) =>
    startTransition(async () => {
      const r = await fn();
      if (r.ok) toast.success(r.message ?? "Listo");
      else toast.error(r.error ?? "Error");
    });

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div className="flex flex-col gap-1.5">
          <CardTitle>Pagos</CardTitle>
          <CardDescription>
            {zone === "provincia" ? "Adelanto antes del envío y saldo cuando llega a la agencia." : "Lima es contraentrega: registra aquí si te pagaron por adelantado."}
          </CardDescription>
        </div>
        <Button size="sm" variant="outline" onClick={() => setOpen((v) => !v)}>
          <Plus /> Registrar pago
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="grid grid-cols-3 gap-2 text-center text-sm">
          <div className="rounded-lg bg-muted/50 p-2">
            <p className="text-xs text-muted-foreground">Total</p>
            <p className="font-semibold">{formatMoney(total)}</p>
          </div>
          <div className="rounded-lg bg-muted/50 p-2">
            <p className="text-xs text-muted-foreground">Pagado</p>
            <p className="font-semibold text-emerald-600">{formatMoney(summary.paid)}</p>
          </div>
          <div className="rounded-lg bg-muted/50 p-2">
            <p className="text-xs text-muted-foreground">Falta</p>
            <p className="font-semibold">{formatMoney(summary.pending)}</p>
          </div>
        </div>

        {open ? (
          <div className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pay-kind">Tipo</Label>
              <select id="pay-kind" value={kind} onChange={(e) => setKind(e.target.value as PaymentKind)} className={selectClass}>
                {Object.entries(PAYMENT_KINDS).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pay-amount">Monto (S/)</Label>
              <Input id="pay-amount" type="number" step="0.01" min={0} value={amount} placeholder={suggested.toFixed(2)} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pay-method">Método</Label>
              <select id="pay-method" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)} className={selectClass}>
                {Object.entries(PAYMENT_METHODS).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pay-date">Fecha</Label>
              <Input id="pay-date" type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor="pay-file">Comprobante (captura o PDF)</Label>
              <Input id="pay-file" type="file" accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </div>
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor="pay-note">Nota (opcional)</Label>
              <Input id="pay-note" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="N.° de operación, quién pagó…" />
            </div>
            <div className="flex justify-end gap-2 sm:col-span-2">
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <Button onClick={submit} disabled={pending}>
                {pending ? "Guardando…" : "Guardar pago"}
              </Button>
            </div>
          </div>
        ) : null}

        {payments.length ? (
          <ul className="flex flex-col divide-y text-sm">
            {payments.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                <span className="font-medium">{PAYMENT_KINDS[p.kind]}</span>
                <span className="tabular-nums">{formatMoney(p.amount)}</span>
                <span className="text-muted-foreground">
                  {PAYMENT_METHODS[p.method]} · {formatDate(p.paid_on)} · {p.created_by_name}
                </span>
                {p.receipt_url ? (
                  <a href={p.receipt_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-primary hover:underline">
                    {p.receipt_is_pdf ? <FileText className="size-3.5" /> : <Paperclip className="size-3.5" />} Comprobante
                  </a>
                ) : (
                  <span className="text-xs text-amber-600">Sin comprobante</span>
                )}
                <span className="ml-auto flex items-center gap-1">
                  {p.verified ? (
                    <span className="flex items-center gap-1 text-xs text-emerald-600">
                      <BadgeCheck className="size-4" /> Verificado{p.verified_by_name ? ` por ${p.verified_by_name}` : ""}
                    </span>
                  ) : (
                    <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => verifyOrderPayment(p.id, orderId))}>
                      <BadgeCheck /> Verificar
                    </Button>
                  )}
                  <Button size="icon-sm" variant="ghost" disabled={pending} onClick={() => run(() => deleteOrderPayment(p.id, orderId))} aria-label="Eliminar pago">
                    <Trash2 />
                  </Button>
                </span>
                {p.note ? <p className="w-full text-xs text-muted-foreground">{p.note}</p> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">Aún no hay pagos registrados.</p>
        )}
      </CardContent>
    </Card>
  );
}
