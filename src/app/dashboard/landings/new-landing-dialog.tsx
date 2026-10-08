"use client";

import { Plus } from "lucide-react";
import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { slugify } from "@/lib/format";
import { cn } from "@/lib/utils";
import { TEMPLATES, type TemplateKey } from "@/modules/landing/defaults";
import { createLanding } from "./actions";

export function NewLandingDialog({
  products,
  defaultProductId,
}: {
  products: { id: string; name: string }[];
  defaultProductId?: string;
}) {
  const [open, setOpen] = useState(Boolean(defaultProductId));
  const initialProduct = products.find((p) => p.id === defaultProductId) ?? products[0];
  const [productId, setProductId] = useState(initialProduct?.id ?? "");
  const [title, setTitle] = useState(initialProduct?.name ?? "");
  const [slug, setSlug] = useState(slugify(initialProduct?.name ?? ""));
  const [slugTouched, setSlugTouched] = useState(false);
  const [template, setTemplate] = useState<TemplateKey>("clasica");
  const [state, action, pending] = useActionState(createLanding, undefined);

  useEffect(() => {
    if (state && !state.ok) toast.error(state.error);
  }, [state]);

  if (!products.length) return null;

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus /> Nueva landing
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nueva landing</DialogTitle>
            <DialogDescription>Elige una plantilla: se arma con las imágenes del producto y luego la editas a tu gusto.</DialogDescription>
          </DialogHeader>
          <form action={action} className="flex flex-col gap-4">
            <input type="hidden" name="template" value={template} />
            <div className="grid grid-cols-2 gap-2">
              {(Object.keys(TEMPLATES) as TemplateKey[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTemplate(key)}
                  className={cn("flex flex-col gap-0.5 rounded-lg border p-2.5 text-left", template === key ? "border-primary bg-primary/5 ring-2 ring-primary/20" : "hover:bg-muted")}
                >
                  <span className="text-sm font-medium">{TEMPLATES[key].label}</span>
                  <span className="text-xs text-muted-foreground">{TEMPLATES[key].description}</span>
                </button>
              ))}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="product_id">Producto</Label>
              <select
                id="product_id"
                name="product_id"
                value={productId}
                onChange={(e) => {
                  setProductId(e.target.value);
                  const name = products.find((p) => p.id === e.target.value)?.name ?? "";
                  setTitle(name);
                  if (!slugTouched) setSlug(slugify(name));
                }}
                className="h-9 rounded-lg border border-input bg-transparent px-2.5 text-sm"
              >
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="title">Título (aparece al compartir el link)</Label>
              <Input
                id="title"
                name="title"
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  if (!slugTouched) setSlug(slugify(e.target.value));
                }}
                required
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="slug">Enlace</Label>
              <Input
                id="slug"
                name="slug"
                value={slug}
                onChange={(e) => {
                  setSlugTouched(true);
                  setSlug(slugify(e.target.value));
                }}
                required
              />
            </div>
            <Button type="submit" disabled={pending}>
              {pending ? "Creando…" : "Crear y editar"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
