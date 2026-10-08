"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { updateOrderDetails } from "../actions";

export function OrderDetailsForm({
  orderId,
  initial,
}: {
  orderId: string;
  initial: { shipping_cost: number; internal_notes: string; address: string; reference: string; courier_name: string; tracking_code: string };
}) {
  const [state, action, pending] = useActionState(updateOrderDetails.bind(null, orderId), undefined);

  useEffect(() => {
    if (!state) return;
    if (state.ok) toast.success(state.message ?? "Guardado");
    else toast.error(state.error);
  }, [state]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Envío, costos y notas internas</CardTitle>
        <CardDescription>El costo de envío es lo que tú pagas al courier. Se descuenta en tu utilidad real.</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="shipping_cost">Costo de envío pagado (S/)</Label>
            <Input id="shipping_cost" name="shipping_cost" type="number" step="0.01" min="0" defaultValue={initial.shipping_cost} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="courier_name">Courier</Label>
            <Input id="courier_name" name="courier_name" defaultValue={initial.courier_name} placeholder="Shalom, Olva, motorizado…" />
          </div>
          <div className="flex flex-col gap-2 sm:col-span-2">
            <Label htmlFor="tracking_code">Código de seguimiento / guía</Label>
            <Input id="tracking_code" name="tracking_code" defaultValue={initial.tracking_code} />
          </div>
          <div className="flex flex-col gap-2 sm:col-span-2">
            <Label htmlFor="address">Dirección</Label>
            <Input id="address" name="address" defaultValue={initial.address} />
          </div>
          <div className="flex flex-col gap-2 sm:col-span-2">
            <Label htmlFor="reference">Referencia</Label>
            <Input id="reference" name="reference" defaultValue={initial.reference} />
          </div>
          <div className="flex flex-col gap-2 sm:col-span-2">
            <Label htmlFor="internal_notes">Notas internas (el cliente no las ve)</Label>
            <Textarea id="internal_notes" name="internal_notes" defaultValue={initial.internal_notes} rows={3} />
          </div>
          <div className="flex justify-end sm:col-span-2">
            <Button type="submit" disabled={pending}>
              {pending ? "Guardando…" : "Guardar"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
