"use client";

import { ChevronDown } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { CANCEL_REASONS, FAILURE_REASONS } from "@/modules/orders/contact";
import { allowedTransitions, nextStatus, ORDER_STATUS_LABELS, type OrderStatus } from "@/modules/orders/state-machine";
import { changeOrderStatus } from "../actions";

const NEGATIVE: OrderStatus[] = ["cancelled", "failed_delivery", "returned"];

function reasonsFor(status: OrderStatus | null): Record<string, string> | null {
  if (status === "cancelled") return CANCEL_REASONS;
  if (status === "failed_delivery" || status === "returned") return FAILURE_REASONS;
  return null;
}

export function StatusActions({ orderId, status }: { orderId: string; status: OrderStatus }) {
  const [pending, startTransition] = useTransition();
  const [target, setTarget] = useState<OrderStatus | null>(null);
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const next = nextStatus(status);
  const others = allowedTransitions(status).filter((s) => s !== next);
  const reasons = reasonsFor(target);

  const apply = (to: OrderStatus, withNote?: string, withReason?: string) =>
    startTransition(async () => {
      const result = await changeOrderStatus(orderId, to, withNote, withReason);
      if (result.ok) toast.success(`Pedido: ${ORDER_STATUS_LABELS[to]}`);
      else toast.error(result.error);
      setTarget(null);
      setNote("");
    });

  if (!next && others.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {next ? (
        <Button onClick={() => apply(next)} disabled={pending}>
          Marcar como {ORDER_STATUS_LABELS[next]}
        </Button>
      ) : null}
      {others.length ? (
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="outline" disabled={pending} />}>
            Otro estado <ChevronDown />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {others.map((s) => (
              <DropdownMenuItem
                key={s}
                variant={NEGATIVE.includes(s) ? "destructive" : "default"}
                onClick={() => {
                  const r = reasonsFor(s);
                  setReason(r ? Object.keys(r)[0] : "");
                  setTarget(s);
                }}
              >
                {ORDER_STATUS_LABELS[s]}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}

      <Dialog open={target !== null} onOpenChange={(open) => !open && setTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cambiar a «{target ? ORDER_STATUS_LABELS[target] : ""}»</DialogTitle>
            <DialogDescription>{reasons ? "Elige el motivo: sirve para analizar por qué se caen tus pedidos." : "Puedes dejar una nota."}</DialogDescription>
          </DialogHeader>
          {reasons ? (
            <select value={reason} onChange={(e) => setReason(e.target.value)} className="h-9 rounded-md border bg-background px-2 text-sm" aria-label="Motivo">
              {Object.entries(reasons).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          ) : null}
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Nota opcional" maxLength={500} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setTarget(null)}>
              Volver
            </Button>
            <Button onClick={() => target && apply(target, note || undefined, reasons ? reason : undefined)} disabled={pending}>
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
