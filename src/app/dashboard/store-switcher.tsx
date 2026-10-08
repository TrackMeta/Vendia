"use client";

import { Check, ChevronsUpDown, Plus } from "lucide-react";
import Link from "next/link";
import { useTransition } from "react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { switchStore } from "./store-actions";

/** Selector de tienda: un usuario puede tener varias tiendas (y ser Confirmador en otras). */
export function StoreSwitcher({ current, currentName, stores }: { current: string; currentName: string; stores: { id: string; name: string; role: "owner" | "staff" }[] }) {
  const [pending, startTransition] = useTransition();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={pending}
        className="-mx-1 flex max-w-full items-center gap-1 rounded-md px-1 py-0.5 text-left text-sm font-medium hover:bg-muted"
        aria-label="Cambiar de tienda"
      >
        <span className="truncate">{currentName}</span>
        <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        {stores.map((s) => (
          <DropdownMenuItem key={s.id} onClick={() => s.id !== current && startTransition(() => switchStore(s.id))}>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate">{s.name}</span>
              {s.role === "staff" ? <span className="text-xs text-muted-foreground">Confirmador</span> : null}
            </span>
            {s.id === current ? <Check className="size-4" /> : null}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<Link href="/onboarding?nueva=1" />}>
          <Plus /> Crear otra tienda
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
