"use client";

import { Loader2, RefreshCw, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addDomain, deleteDomain, verifyDomain } from "./actions";

export function AddDomainForm({ storeName }: { storeName: string }) {
  const [pending, startTransition] = useTransition();
  const [domain, setDomain] = useState("");
  const [scope, setScope] = useState<"store" | "all">("store");
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const r = await addDomain({ domain, scope });
          if (r.ok) {
            toast.success(r.message ?? "Agregado");
            setDomain("");
          } else toast.error(r.error);
        });
      }}
    >
      <Input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="tienda.midominio.pe" aria-label="Dominio" />
      <div className="flex flex-col gap-1.5 text-sm">
        <label className="flex items-center gap-2">
          <input type="radio" checked={scope === "store"} onChange={() => setScope("store")} className="size-4" />
          Solo para «{storeName}» · las landings quedan como dominio.pe/<b>landing</b>
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" checked={scope === "all"} onChange={() => setScope("all")} className="size-4" />
          Para todas mis tiendas · dominio.pe/<b>tienda</b>/<b>landing</b>
        </label>
      </div>
      <Button type="submit" disabled={pending || domain.trim().length < 4} className="w-fit">
        {pending ? <Loader2 className="animate-spin" /> : null} Agregar dominio
      </Button>
    </form>
  );
}

export function DomainActions({ id }: { id: string }) {
  const [pending, startTransition] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; message?: string; error?: string }>) =>
    startTransition(async () => {
      const r = await fn();
      if (r.ok) toast.success(r.message ?? "Listo");
      else toast.error(r.error ?? "Error");
    });
  return (
    <div className="flex gap-1">
      <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => verifyDomain(id))}>
        {pending ? <Loader2 className="animate-spin" /> : <RefreshCw />} Verificar
      </Button>
      <Button
        size="icon-sm"
        variant="ghost"
        disabled={pending}
        aria-label="Eliminar dominio"
        onClick={() => {
          if (confirm("¿Eliminar este dominio? Los links con ese dominio dejarán de funcionar.")) run(() => deleteDomain(id));
        }}
      >
        <Trash2 />
      </Button>
    </div>
  );
}
