"use client";

import { Pencil } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { VariantBreakdown } from "@/modules/orders/items";
import { setOrderVariants } from "../actions";

/**
 * Variantes del pedido (talla, color…): el confirmador puede cambiarlas al llamar al cliente,
 * mientras el pedido no haya salido. Si el stock ya estaba descontado, se ajusta solo.
 */
export function VariantsEditor({
  orderId,
  label,
  units,
  current,
  options,
  editable,
}: {
  orderId: string;
  label: string;
  units: number;
  current: VariantBreakdown;
  options: { id: string; name: string; stock: number | null }[];
  editable: boolean;
}) {
  const initial = current.flatMap((b) => Array.from({ length: b.quantity }, () => b.variant_id));
  const [editing, setEditing] = useState(false);
  const [picks, setPicks] = useState<string[]>(Array.from({ length: units }, (_, i) => initial[i] ?? ""));
  const [pending, startTransition] = useTransition();

  const save = () =>
    startTransition(async () => {
      const r = await setOrderVariants(orderId, picks);
      if (r.ok) {
        toast.success(r.message ?? "Variantes guardadas");
        setEditing(false);
      } else toast.error(r.error);
    });

  return (
    <div className="flex flex-col gap-2 rounded-lg bg-muted/50 p-2.5 text-sm">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">{label}:</span>
        <span className="font-medium">
          {current.length ? current.map((b) => (b.quantity > 1 ? `${b.name} ×${b.quantity}` : b.name)).join(", ") : <span className="text-amber-600">sin elegir</span>}
        </span>
        {editable && !editing ? (
          <Button size="xs" variant="ghost" className="ml-auto" onClick={() => setEditing(true)}>
            <Pencil /> Cambiar
          </Button>
        ) : null}
      </div>
      {editing ? (
        <div className="flex flex-col gap-2">
          {picks.map((pick, i) => (
            <div key={i} className="flex flex-wrap items-center gap-1.5">
              <span className="w-20 text-xs text-muted-foreground">Unidad {i + 1}</span>
              {options.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => setPicks((ps) => ps.map((p, j) => (j === i ? o.id : p)))}
                  className={`rounded-md border px-2.5 py-1 text-xs font-medium ${pick === o.id ? "border-foreground bg-foreground text-background" : "hover:bg-muted"}`}
                  title={o.stock === null ? "Sin control de stock" : `Stock: ${o.stock}`}
                >
                  {o.name}
                  {o.stock !== null ? <span className="ml-1 opacity-60">({o.stock})</span> : null}
                </button>
              ))}
            </div>
          ))}
          <div className="flex gap-2">
            <Button size="sm" onClick={save} disabled={pending || picks.some((p) => !p)}>
              {pending ? "Guardando…" : "Guardar"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancelar
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
