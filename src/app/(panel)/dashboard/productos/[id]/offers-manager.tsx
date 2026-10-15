"use client";

import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ImageDropzone } from "@/components/dashboard/image-dropzone";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { publicAssetUrl } from "@/lib/env";
import { formatMoney } from "@/lib/format";
import { saveOffers } from "../actions";

type Offer = {
  id?: string;
  name: string;
  quantity: number;
  price: number;
  compare_at_price: number | null;
  badge: string | null;
  image_path: string | null;
  is_default: boolean;
  is_active: boolean;
};

export function OffersManager({
  storeId,
  productId,
  productPrice,
  initial,
}: {
  storeId: string;
  productId: string;
  productPrice: number;
  initial: Offer[];
}) {
  const [offers, setOffers] = useState<Offer[]>(initial);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const [prevInitial, setPrevInitial] = useState(initial);
  if (initial !== prevInitial) {
    setPrevInitial(initial);
    setOffers(initial);
  }

  const update = (index: number, patch: Partial<Offer>) =>
    setOffers((list) =>
      list.map((o, i) => {
        if (patch.is_default && i !== index) return { ...o, is_default: false };
        return i === index ? { ...o, ...patch } : o;
      }),
    );

  const move = (index: number, dir: -1 | 1) =>
    setOffers((list) => {
      const next = [...list];
      const target = index + dir;
      if (target < 0 || target >= next.length) return list;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });

  const add = () => {
    const quantity = (offers.at(-1)?.quantity ?? 0) + 1;
    setOffers((list) => [
      ...list,
      {
        name: `${quantity} unidades`,
        quantity,
        price: Math.round(productPrice * quantity * 0.85 * 10) / 10,
        compare_at_price: productPrice * quantity,
        badge: null,
        image_path: null,
        is_default: list.length === 0,
        is_active: true,
      },
    ]);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Ofertas por cantidad</CardTitle>
        <CardDescription>
          Aparecen en el formulario de la landing (ej: 1 unidad S/ 89.90 · 2 unidades S/ 129.90 «Lo más vendido»). El precio
          final siempre se valida en el servidor.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {offers.map((offer, index) => (
          <div key={offer.id ?? `new-${index}`} className="flex flex-col gap-3 rounded-lg border p-3">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
              <div className="col-span-2 flex flex-col gap-1.5 sm:col-span-2">
                <Label className="text-xs">Nombre</Label>
                <Input value={offer.name} onChange={(e) => update(index, { name: e.target.value })} placeholder="Plan Capilar" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs">Unidades</Label>
                <Input type="number" min={1} value={offer.quantity} onChange={(e) => update(index, { quantity: Number(e.target.value) })} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs">Precio (S/)</Label>
                <Input type="number" step="0.01" min={0} value={offer.price} onChange={(e) => update(index, { price: Number(e.target.value) })} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs">Tachado (S/)</Label>
                <Input
                  type="number"
                  step="0.01"
                  min={0}
                  value={offer.compare_at_price ?? ""}
                  onChange={(e) => update(index, { compare_at_price: e.target.value === "" ? null : Number(e.target.value) })}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs">Etiqueta</Label>
                <Input value={offer.badge ?? ""} onChange={(e) => update(index, { badge: e.target.value || null })} placeholder="Lo más vendido" />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <div className="w-40">
                {offer.image_path ? (
                  <div className="flex items-center gap-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={publicAssetUrl(offer.image_path)!} alt="" className="size-10 rounded border object-cover" />
                    <button type="button" className="text-xs text-muted-foreground underline" onClick={() => update(index, { image_path: null })}>
                      Quitar imagen
                    </button>
                  </div>
                ) : (
                  <ImageDropzone
                    compact
                    multiple={false}
                    maxSize={400}
                    storeId={storeId}
                    folder={`products/${productId}/offers`}
                    label="Imagen (opcional)"
                    onUploaded={(imgs) => update(index, { image_path: imgs[0].path })}
                  />
                )}
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={offer.is_default} onCheckedChange={(v) => update(index, { is_default: v })} />
                Seleccionada por defecto
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={offer.is_active} onCheckedChange={(v) => update(index, { is_active: v })} />
                Activa
              </label>
              <span className="text-xs text-muted-foreground">
                {formatMoney(offer.quantity ? offer.price / offer.quantity : null)} c/u
              </span>
              <div className="ml-auto flex gap-1">
                <Button type="button" size="icon-sm" variant="ghost" onClick={() => move(index, -1)} aria-label="Subir">
                  <ArrowUp />
                </Button>
                <Button type="button" size="icon-sm" variant="ghost" onClick={() => move(index, 1)} aria-label="Bajar">
                  <ArrowDown />
                </Button>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => setOffers((list) => list.filter((_, i) => i !== index))}
                  aria-label="Eliminar oferta"
                >
                  <Trash2 />
                </Button>
              </div>
            </div>
          </div>
        ))}
        <div className="flex flex-wrap justify-between gap-2">
          <Button type="button" variant="outline" onClick={add} disabled={offers.length >= 10}>
            <Plus /> Agregar oferta
          </Button>
          <Button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await saveOffers(productId, offers);
                if (result.ok) {
                  toast.success(result.message ?? "Guardado");
                  router.refresh();
                }
                else toast.error(result.error);
              })
            }
          >
            {pending ? "Guardando…" : "Guardar ofertas"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
