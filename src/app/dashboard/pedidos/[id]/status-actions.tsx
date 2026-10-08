"use client";

import { ChevronDown } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { allowedTransitions, nextStatus, ORDER_STATUS_LABELS, type OrderStatus } from "@/modules/orders/state-machine";
import { changeOrderStatus } from "../actions";

const NEGATIVE: OrderStatus[] = ["cancelled", "failed_delivery", "returned"];

export function StatusActions({ orderId, status }: { orderId: string; status: OrderStatus }) {
  const [pending, startTransition] = useTransition();
  const [target, setTarget] = useState<OrderStatus | null>(null);
  const [note, setNote] = useState("");
  const next = nextStatus(status);
  const others = allowedTransitions(status).filter((s) => s !== next);

  const apply = (to: OrderStatus, withNote?: string) =>
    startTransition(async () => {
      const result = await changeOrderStatus(orderId, to, withNote);
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
              <DropdownMenuItem key={s} variant={NEGATIVE.includes(s) ? "destructive" : "default"} onClick={() => setTarget(s)}>
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
            <DialogDescription>Puedes dejar una nota (por ejemplo, el motivo de la cancelación).</DialogDescription>
          </DialogHeader>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Nota opcional" maxLength={500} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setTarget(null)}>
              Volver
            </Button>
            <Button onClick={() => target && apply(target, note || undefined)} disabled={pending}>
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
