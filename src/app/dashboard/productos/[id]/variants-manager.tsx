"use client";

import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { saveVariants } from "../actions";

type Variant = { id?: string; name: string; sku: string; stock: number | null; is_active: boolean };

const PRESETS: Record<string, string[]> = {
  Talla: ["S", "M", "L", "XL"],
  "Talla (número)": ["36", "37", "38", "39", "40"],
  Color: ["Negro", "Blanco", "Beige"],
};

/** Variantes del producto (talla, color…): el cliente elige una por unidad y cada una tiene su stock. */
export function VariantsManager({ productId, initialLabel, initial }: { productId: string; initialLabel: string | null; initial: Variant[] }) {
  const [pending, startTransition] = useTransition();
  const [label, setLabel] = useState(initialLabel ?? "Talla");
  const [variants, setVariants] = useState<Variant[]>(initial);
  const set = (i: number, patch: Partial<Variant>) => setVariants((vs) => vs.map((v, j) => (j === i ? { ...v, ...patch } : v)));
  const move = (i: number, d: -1 | 1) =>
    setVariants((vs) => {
      const next = [...vs];
      const j = i + d;
      if (j < 0 || j >= next.length) return vs;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  const save = () =>
    startTransition(async () => {
      const r = await saveVariants(productId, {
        label,
        variants: variants.map((v) => ({ id: v.id, name: v.name, sku: v.sku, stock: v.stock === null ? "" : v.stock, is_active: v.is_active })),
      });
      if (r.ok) toast.success(r.message ?? "Guardado");
      else toast.error(r.error);
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Variantes</CardTitle>
        <CardDescription>
          Tallas, colores o modelos. En la landing el cliente elige una por cada unidad de su oferta (ej. 2 fajas: una M y una L). Cada variante tiene su stock;
          déjalo vacío si no controlas stock.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {variants.length ? (
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium" htmlFor="variant-label">
              ¿Qué elige el cliente?
            </label>
            <Input id="variant-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Talla" className="max-w-60" />
          </div>
        ) : null}
        {variants.map((v, i) => (
          <div key={v.id ?? `new-${i}`} className="grid grid-cols-[1fr_6rem_auto] items-center gap-2 sm:grid-cols-[1fr_8rem_6rem_auto]">
            <Input value={v.name} onChange={(e) => set(i, { name: e.target.value })} placeholder="M" aria-label="Nombre de la variante" />
            <Input value={v.sku} onChange={(e) => set(i, { sku: e.target.value })} placeholder="SKU (opcional)" aria-label="SKU" className="hidden sm:block" />
            <Input
              type="number"
              min={0}
              value={v.stock ?? ""}
              onChange={(e) => set(i, { stock: e.target.value === "" ? null : Math.max(0, Math.round(Number(e.target.value) || 0)) })}
              placeholder="Stock"
              aria-label="Stock"
            />
            <div className="flex items-center">
              <label className="mr-1 flex items-center gap-1 text-xs text-muted-foreground" title="Activa en la landing">
                <input type="checkbox" checked={v.is_active} onChange={(e) => set(i, { is_active: e.target.checked })} className="size-3.5" />
                Activa
              </label>
              <Button type="button" size="icon-xs" variant="ghost" onClick={() => move(i, -1)} aria-label="Subir">
                <ArrowUp />
              </Button>
              <Button type="button" size="icon-xs" variant="ghost" onClick={() => move(i, 1)} aria-label="Bajar">
                <ArrowDown />
              </Button>
              <Button type="button" size="icon-xs" variant="ghost" onClick={() => setVariants((vs) => vs.filter((_, j) => j !== i))} aria-label="Quitar">
                <Trash2 />
              </Button>
            </div>
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => setVariants((vs) => [...vs, { name: "", sku: "", stock: null, is_active: true }])}>
            <Plus /> Agregar variante
          </Button>
          {!variants.length
            ? Object.entries(PRESETS).map(([name, values]) => (
                <Button
                  key={name}
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setLabel(name.replace(" (número)", ""));
                    setVariants(values.map((value) => ({ name: value, sku: "", stock: null, is_active: true })));
                  }}
                >
                  Usar {name.toLowerCase()}: {values.join(", ")}
                </Button>
              ))
            : null}
        </div>
        <div className="flex justify-end">
          <Button onClick={save} disabled={pending}>
            {pending ? "Guardando…" : "Guardar variantes"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
