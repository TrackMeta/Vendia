"use client";

import { Check, ChevronsUpDown, Loader2, Plus } from "lucide-react";
import Link from "next/link";
import { useTransition } from "react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { switchStore } from "./store-actions";

type StoreOption = { id: string; name: string; role: "owner" | "staff"; logo: string | null };

/**
 * Logo de la tienda (el de Configuración) sobre fondo blanco; si no tiene, su inicial en un cuadrito.
 * Ayuda a reconocer cada tienda de un vistazo cuando hay varias.
 */
function StoreAvatar({ name, logo, className }: { name: string; logo: string | null; className?: string }) {
  if (logo) {
    return (
      <span className={cn("flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-md bg-white p-0.5", className)}>
        {/* eslint-disable-next-line @next/next/no-img-element -- logo pequeño subido por el vendedor */}
        <img src={logo} alt="" className="size-full object-contain" />
      </span>
    );
  }
  return (
    <span aria-hidden className={cn("flex size-8 shrink-0 items-center justify-center rounded-md text-sm font-semibold uppercase", className)}>
      {name.trim().charAt(0) || "T"}
    </span>
  );
}

const siteHost = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/^https?:\/\//, "").replace(/\/$/, "");

/**
 * Selector de tienda (arriba del menú). Un usuario puede tener varias tiendas propias y ser
 * Confirmador en otras; todo el panel muestra solo la tienda elegida aquí.
 */
export function StoreSwitcher({
  current,
  currentName,
  currentLogo,
  slug,
  isOwner,
  stores,
}: {
  current: string;
  currentName: string;
  currentLogo: string | null;
  slug: string;
  isOwner: boolean;
  stores: StoreOption[];
}) {
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex flex-col gap-1.5 rounded-lg bg-white/[0.04] p-1.5">
      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={pending}
          className="flex w-full items-center gap-2.5 rounded-md p-1 text-left transition-colors hover:bg-white/[0.06]"
          aria-label={`Tienda actual: ${currentName}. Cambiar de tienda`}
        >
          <StoreAvatar name={currentName} logo={currentLogo} className="bg-white/10 text-white" />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-[10px] font-medium tracking-wide text-white/40 uppercase">{isOwner ? "Tienda" : "Tienda · Confirmador"}</span>
            <span className="truncate text-sm font-medium text-white">{currentName}</span>
          </span>
          {pending ? <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" /> : <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Tus tiendas ({stores.length})</DropdownMenuLabel>
            {stores.map((s) => (
              <DropdownMenuItem key={s.id} onClick={() => s.id !== current && startTransition(() => switchStore(s.id))} className="gap-2.5">
                <StoreAvatar name={s.name} logo={s.logo} className={cn("size-7 text-xs", s.logo ? "ring-1 ring-border" : s.id === current ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{s.name}</span>
                  <span className="text-xs text-muted-foreground">{s.role === "owner" ? "Dueño" : "Confirmador"}</span>
                </span>
                {s.id === current ? <Check className="size-4" /> : null}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem render={<Link href="/onboarding?nueva=1" />} className="gap-2.5">
            <span className="flex size-7 items-center justify-center rounded-md border border-dashed">
              <Plus className="size-3.5" />
            </span>
            Crear otra tienda
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {/* Dirección pública: la base de todas las landings de esta tienda */}
      <Link
        href={isOwner ? "/dashboard/landings" : "/dashboard/pedidos"}
        title="Dirección de tu tienda: tus landings se publican debajo de ella"
        className="truncate rounded-md px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:text-white"
      >
        {siteHost ? `${siteHost}/p/${slug}` : `/p/${slug}`}
      </Link>
    </div>
  );
}
