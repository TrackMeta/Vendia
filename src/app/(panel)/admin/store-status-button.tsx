"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { setStoreStatus } from "./actions";

export function StoreStatusButton({ storeId, status, name }: { storeId: string; status: "active" | "blocked"; name: string }) {
  const [pending, startTransition] = useTransition();
  const next = status === "active" ? "blocked" : "active";
  return (
    <Button
      size="xs"
      variant={next === "blocked" ? "destructive" : "outline"}
      disabled={pending}
      onClick={() => {
        if (next === "blocked" && !confirm(`¿Bloquear «${name}»? Sus landings dejarán de recibir pedidos.`)) return;
        startTransition(async () => {
          const r = await setStoreStatus(storeId, next);
          if (r.ok) toast.success(r.message ?? "Listo");
          else toast.error(r.error);
        });
      }}
    >
      {next === "blocked" ? "Bloquear" : "Reactivar"}
    </Button>
  );
}
