"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PACKAGE_SIZES } from "@/modules/couriers";
import type { ActionResult } from "./actions";

export type ProductFormValues = {
  name: string;
  sku: string | null;
  description: string | null;
  price: number | string;
  compare_at_price: number | string | null;
  cost: number | string;
  stock: number | null;
  category: string | null;
  status: "draft" | "active" | "archived";
  package_size?: string;
  package_weight?: number | string;
  package_height?: number | string;
  package_width?: number | string;
  package_length?: number | string;
};

const EMPTY: ProductFormValues = {
  name: "",
  sku: null,
  description: null,
  price: "",
  compare_at_price: null,
  cost: "",
  stock: null,
  category: null,
  status: "active",
};

const nativeSelect =
  "h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export function ProductForm({
  action,
  initial = EMPTY,
  submitLabel,
}: {
  action: (state: ActionResult | undefined, formData: FormData) => Promise<ActionResult>;
  initial?: ProductFormValues;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);

  useEffect(() => {
    if (!state) return;
    if (state.ok) toast.success(state.message ?? "Guardado");
    else toast.error(state.error);
  }, [state]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Datos del producto</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2 sm:col-span-2">
            <Label htmlFor="name">Nombre</Label>
            <Input id="name" name="name" required defaultValue={initial.name} placeholder="Faja reductora térmica" />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="price">Precio de venta (S/)</Label>
            <Input id="price" name="price" type="number" step="0.01" min="0" required defaultValue={initial.price} placeholder="79.90" />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="compare_at_price">Precio anterior / tachado (S/)</Label>
            <Input id="compare_at_price" name="compare_at_price" type="number" step="0.01" min="0" defaultValue={initial.compare_at_price ?? ""} placeholder="129.90" />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="cost">Costo por unidad (S/)</Label>
            <Input id="cost" name="cost" type="number" step="0.01" min="0" required defaultValue={initial.cost} placeholder="25.00" />
            <p className="text-xs text-muted-foreground">Lo que te cuesta a ti. Se usa para calcular tu utilidad real.</p>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="stock">Stock (opcional)</Label>
            <Input id="stock" name="stock" type="number" min="0" step="1" defaultValue={initial.stock ?? ""} />
            <p className="text-xs text-muted-foreground">Se descuenta al confirmar y vuelve si se cancela o no se entrega. Vacío = sin control.</p>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="sku">SKU (opcional)</Label>
            <Input id="sku" name="sku" defaultValue={initial.sku ?? ""} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="category">Categoría (opcional)</Label>
            <Input id="category" name="category" defaultValue={initial.category ?? ""} placeholder="Salud y belleza" />
          </div>
          <div className="grid gap-3 rounded-lg border p-3 sm:col-span-2 sm:grid-cols-5">
            <p className="text-sm font-medium sm:col-span-5">
              Paquete para el courier <span className="font-normal text-muted-foreground">· se usa en la planilla de Shalom (medidas en cm, 0 si no las sabes)</span>
            </p>
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor="package_size">Medida</Label>
              <select id="package_size" name="package_size" defaultValue={initial.package_size ?? "PAQUETE S"} className={nativeSelect}>
                {PACKAGE_SIZES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="package_weight">Peso (kg)</Label>
              <Input id="package_weight" name="package_weight" type="number" step="0.1" min="0" defaultValue={initial.package_weight ?? 1} />
            </div>
            <div className="grid grid-cols-3 gap-1.5 sm:col-span-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="package_height">Alto</Label>
                <Input id="package_height" name="package_height" type="number" step="0.1" min="0" defaultValue={initial.package_height ?? 0} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="package_width">Ancho</Label>
                <Input id="package_width" name="package_width" type="number" step="0.1" min="0" defaultValue={initial.package_width ?? 0} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="package_length">Largo</Label>
                <Input id="package_length" name="package_length" type="number" step="0.1" min="0" defaultValue={initial.package_length ?? 0} />
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:col-span-2">
            <Label htmlFor="description">Descripción (opcional)</Label>
            <Textarea id="description" name="description" rows={3} defaultValue={initial.description ?? ""} />
            <p className="text-xs text-muted-foreground">Se usa como descripción al compartir la landing en WhatsApp o Facebook.</p>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="status">Estado</Label>
            <select id="status" name="status" defaultValue={initial.status} className={nativeSelect}>
              <option value="active">Activo</option>
              <option value="draft">Borrador</option>
              <option value="archived">Archivado</option>
            </select>
          </div>
          <div className="flex items-end justify-end sm:col-span-2">
            <Button type="submit" disabled={pending}>
              {pending ? "Guardando…" : submitLabel}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
