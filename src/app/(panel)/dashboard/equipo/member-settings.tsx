"use client";

import { Plus, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatDate, formatMoney } from "@/lib/format";
import { addCommissionPayment, deleteCommissionPayment, updateMemberSettings } from "./actions";

export const MEMBER_COLORS = ["#2563eb", "#16a34a", "#ea580c", "#9333ea", "#db2777", "#0891b2", "#ca8a04", "#4b5563"];

/** Color y comisión por pedido confirmado (Lima / provincia) de una persona del equipo. */
export function MemberSettings({ userId, color, commissionLima, commissionProvince }: { userId: string; color: string | null; commissionLima: number; commissionProvince: number }) {
  const [pending, startTransition] = useTransition();
  const [c, setC] = useState(color ?? MEMBER_COLORS[0]);
  const [lima, setLima] = useState(String(commissionLima));
  const [prov, setProv] = useState(String(commissionProvince));
  const save = () =>
    startTransition(async () => {
      const r = await updateMemberSettings({ userId, color: c, commissionLima: Number(lima) || 0, commissionProvince: Number(prov) || 0 });
      if (r.ok) toast.success(r.message ?? "Guardado");
      else toast.error(r.error);
    });
  return (
    <div className="flex flex-wrap items-end gap-3 rounded-lg bg-muted/40 p-2.5">
      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">Color</span>
        <div className="flex gap-1">
          {MEMBER_COLORS.map((x) => (
            <button
              key={x}
              type="button"
              onClick={() => setC(x)}
              aria-label={`Color ${x}`}
              className={`size-6 rounded-full border-2 ${c === x ? "border-foreground" : "border-transparent"}`}
              style={{ backgroundColor: x }}
            />
          ))}
        </div>
      </div>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        Comisión Lima (S/)
        <Input type="number" step="0.5" min={0} value={lima} onChange={(e) => setLima(e.target.value)} className="h-8 w-24" />
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        Comisión provincia (S/)
        <Input type="number" step="0.5" min={0} value={prov} onChange={(e) => setProv(e.target.value)} className="h-8 w-24" />
      </label>
      <Button size="sm" variant="outline" onClick={save} disabled={pending}>
        {pending ? "Guardando…" : "Guardar"}
      </Button>
    </div>
  );
}

export type CommissionRow = {
  user_id: string;
  name: string;
  color: string | null;
  generated: number;
  generated_orders: number;
  annulled: number;
  paid: number;
  last_paid_on: string | null;
};

export type PaymentRow = { id: string; user_id: string; amount: number; paid_on: string; note: string | null };

function limaToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" }).format(new Date());
}

/** Tabla de comisiones: generada − pagada = pendiente, con pagos registrados. */
export function CommissionsTable({ rows, payments, canManage }: { rows: CommissionRow[]; payments: PaymentRow[]; canManage: boolean }) {
  const [paying, setPaying] = useState<CommissionRow | null>(null);
  const [history, setHistory] = useState<CommissionRow | null>(null);
  const [amount, setAmount] = useState("");
  const [paidOn, setPaidOn] = useState(limaToday);
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();

  const pay = () =>
    startTransition(async () => {
      if (!paying) return;
      const r = await addCommissionPayment({ userId: paying.user_id, amount: Number(amount), paidOn, note });
      if (r.ok) {
        toast.success(r.message ?? "Pago registrado");
        setPaying(null);
        setAmount("");
        setNote("");
      } else toast.error(r.error);
    });

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr className="border-b">
              <th className="py-2 text-left font-medium">Persona</th>
              <th className="py-2 text-right font-medium">Generada</th>
              <th className="py-2 text-right font-medium" title="Pedidos cancelados, no entregados o devueltos: no pagan comisión">
                Anulada
              </th>
              <th className="py-2 text-right font-medium">Pagada</th>
              <th className="py-2 text-right font-medium">Pendiente</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const pendingAmount = Math.round((Number(r.generated) - Number(r.paid)) * 100) / 100;
              return (
                <tr key={r.user_id} className="border-b last:border-0">
                  <td className="py-2">
                    <span className="flex items-center gap-2">
                      <span className="size-2.5 rounded-full" style={{ backgroundColor: r.color ?? "#9ca3af" }} />
                      {r.name}
                    </span>
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {formatMoney(r.generated)}
                    <span className="block text-xs text-muted-foreground">{r.generated_orders} pedido(s)</span>
                  </td>
                  <td className="py-2 text-right text-muted-foreground tabular-nums line-through decoration-muted-foreground/40">{formatMoney(r.annulled)}</td>
                  <td className="py-2 text-right tabular-nums">
                    {formatMoney(r.paid)}
                    {r.last_paid_on ? <span className="block text-xs text-muted-foreground">último {formatDate(r.last_paid_on)}</span> : null}
                  </td>
                  <td className={`py-2 text-right font-semibold tabular-nums ${pendingAmount > 0 ? "text-amber-600" : ""}`}>{formatMoney(pendingAmount)}</td>
                  <td className="py-2 text-right">
                    <span className="flex justify-end gap-1">
                      <Button size="xs" variant="ghost" onClick={() => setHistory(r)}>
                        Pagos
                      </Button>
                      {canManage ? (
                        <Button
                          size="xs"
                          variant="outline"
                          onClick={() => {
                            setPaying(r);
                            setAmount(pendingAmount > 0 ? String(pendingAmount) : "");
                          }}
                        >
                          <Plus /> Pagar
                        </Button>
                      ) : null}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Dialog open={paying !== null} onOpenChange={(o) => !o && setPaying(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Registrar pago a {paying?.name}</DialogTitle>
            <DialogDescription>Lo que le pagaste de su comisión. Se resta de lo pendiente.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              Monto (S/)
              <Input type="number" step="0.1" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Fecha
              <Input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-sm sm:col-span-2">
              Nota (opcional)
              <Input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="Yape, semana 1–7 oct…" />
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setPaying(null)}>
              Cancelar
            </Button>
            <Button onClick={pay} disabled={pending || !(Number(amount) > 0)}>
              Registrar pago
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={history !== null} onOpenChange={(o) => !o && setHistory(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Pagos a {history?.name}</DialogTitle>
          </DialogHeader>
          <ul className="flex max-h-80 flex-col divide-y overflow-y-auto text-sm">
            {payments
              .filter((p) => p.user_id === history?.user_id)
              .map((p) => (
                <li key={p.id} className="flex items-center gap-2 py-2">
                  <span className="font-medium tabular-nums">{formatMoney(p.amount)}</span>
                  <span className="text-muted-foreground">
                    {formatDate(p.paid_on)}
                    {p.note ? ` · ${p.note}` : ""}
                  </span>
                  {canManage ? (
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      className="ml-auto"
                      aria-label="Eliminar pago"
                      onClick={() =>
                        startTransition(async () => {
                          const r = await deleteCommissionPayment(p.id);
                          if (r.ok) toast.success(r.message ?? "Eliminado");
                          else toast.error(r.error);
                        })
                      }
                    >
                      <Trash2 />
                    </Button>
                  ) : null}
                </li>
              ))}
            {!payments.some((p) => p.user_id === history?.user_id) ? <li className="py-2 text-muted-foreground">Aún no hay pagos.</li> : null}
          </ul>
        </DialogContent>
      </Dialog>
    </>
  );
}
