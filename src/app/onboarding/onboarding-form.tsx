"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { slugify } from "@/lib/format";
import { COUNTRIES, UPCOMING_COUNTRIES } from "@/modules/country";
import { createStore } from "./actions";

export function OnboardingForm() {
  const [state, action, pending] = useActionState(createStore, undefined);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Crea tu tienda</CardTitle>
        <CardDescription>Puedes tener varias tiendas y cambiar el nombre después.</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="name">Nombre de la tienda</Label>
            <Input
              id="name"
              name="name"
              required
              className="h-10"
              placeholder="Mi Tienda Perú"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (!slugTouched) setSlug(slugify(e.target.value));
              }}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="slug">Enlace de tu tienda</Label>
            <div className="flex items-center rounded-lg border bg-muted/50 pl-3 text-sm text-muted-foreground focus-within:ring-2 focus-within:ring-ring/50">
              <span className="whitespace-nowrap">vendia/p/</span>
              <input
                id="slug"
                name="slug"
                required
                className="h-10 w-full bg-transparent px-1 text-foreground outline-none"
                value={slug}
                onChange={(e) => {
                  setSlugTouched(true);
                  setSlug(slugify(e.target.value));
                }}
              />
            </div>
            <p className="text-xs text-muted-foreground">Aparece en los links de tus landings. No se puede cambiar luego.</p>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="country">País</Label>
            <select id="country" disabled className="h-10 rounded-lg border bg-muted/50 px-3 text-sm" defaultValue="PE">
              {Object.values(COUNTRIES).map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name} · {c.currency}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">Próximamente: {UPCOMING_COUNTRIES.join(", ")}.</p>
          </div>
          {state?.error ? (
            <p role="alert" className="text-sm text-destructive">
              {state.error}
            </p>
          ) : null}
          <Button type="submit" size="lg" className="h-10" disabled={pending}>
            {pending ? "Creando…" : "Crear tienda"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
