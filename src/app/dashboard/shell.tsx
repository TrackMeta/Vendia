"use client";

import { Home, LogOut, Menu, ShoppingBag, Trophy, Truck, Users } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { logout } from "@/app/(auth)/actions";
import { BrandLogo } from "@/components/brand";
import { NotificationBell } from "@/components/dashboard/notifications";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { CommandMenu, SearchButton } from "./command-menu";
import { HELP_ITEM, isActive, type NavItem, visibleGroups } from "./nav";
import { StoreSwitcher } from "./store-switcher";

const FULL_PREFETCH = { kind: "full" } as unknown as Parameters<ReturnType<typeof useRouter>["prefetch"]>[1];

/**
 * Enlace del menú que carga la sección completa (datos incluidos) apenas el usuario muestra
 * intención: pasar el mouse, enfocar con teclado o tocar en el celular. Entre ese gesto y el clic
 * el servidor ya está trabajando, así que la página aparece casi al instante.
 * prefetch={false}: sin esto, Next precarga todas las secciones del menú tras cada clic (decenas de
 * consultas al servidor que casi nunca se usan); así solo se carga la que el usuario va a abrir.
 */
function IntentLink(props: React.ComponentProps<typeof Link> & { href: string }) {
  const router = useRouter();
  // kind "full": trae también los datos de la página (por defecto solo llega hasta el esqueleto)
  const warm = () => router.prefetch(props.href, FULL_PREFETCH);
  return <Link {...props} prefetch={false} onMouseEnter={warm} onFocus={warm} onTouchStart={warm} />;
}

/** Ítem del menú grafito: la sección activa lleva la barra roja de la marca. */
function NavLink({ item, onNavigate }: { item: NavItem; onNavigate?: () => void }) {
  const active = isActive(item, usePathname());
  return (
    <IntentLink
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex items-center gap-3 rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-white",
        active && "bg-white/[0.08] font-medium text-white before:absolute before:inset-y-1.5 before:left-0 before:w-[3px] before:rounded-full before:bg-primary",
      )}
    >
      <item.icon className={cn("size-4", active && "text-[#ff6b66]")} />
      <span className="flex-1">{item.label}</span>
    </IntentLink>
  );
}

function Nav({ onNavigate, isOwner }: { onNavigate?: () => void; isOwner: boolean }) {
  return (
    <nav className="flex flex-col gap-4">
      {visibleGroups(isOwner).map((group) => (
        <div key={group.label ?? "inicio"} className="flex flex-col gap-0.5">
          {group.label ? <p className="px-3 pb-1 text-[11px] font-medium tracking-wide text-white/40 uppercase">{group.label}</p> : null}
          {group.items.map((item) => (
            <NavLink key={item.href} item={item} onNavigate={onNavigate} />
          ))}
        </div>
      ))}
    </nav>
  );
}

/** Barra inferior en el celular: lo que el equipo usa todo el día, al alcance del pulgar. */
function BottomNav({ isOwner, onMore }: { isOwner: boolean; onMore: () => void }) {
  const pathname = usePathname();
  const items: NavItem[] = [
    ...(isOwner ? [{ href: "/dashboard", label: "Inicio", icon: Home, exact: true }] : []),
    { href: "/dashboard/pedidos", label: "Pedidos", icon: ShoppingBag },
    { href: "/dashboard/logistica", label: "Logística", icon: Truck },
    { href: "/dashboard/clientes", label: "Clientes", icon: Users },
    ...(isOwner ? [] : [{ href: "/dashboard/mi-rendimiento", label: "Mi rendimiento", icon: Trophy }]),
  ];
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden" aria-label="Navegación principal">
      <div className="mx-auto flex max-w-md items-stretch justify-around">
        {items.map((item) => {
          const active = isActive(item, pathname);
          return (
            <IntentLink
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn("flex min-w-0 flex-1 flex-col items-center gap-0.5 py-2 text-[11px] text-muted-foreground", active && "font-medium text-primary")}
            >
              <item.icon className="size-5" />
              <span className="truncate">{item.label}</span>
            </IntentLink>
          );
        })}
        <button type="button" onClick={onMore} className="flex min-w-0 flex-1 flex-col items-center gap-0.5 py-2 text-[11px] text-muted-foreground">
          <Menu className="size-5" />
          Más
        </button>
      </div>
    </nav>
  );
}

export function DashboardShell({
  children,
  storeName,
  storeSlug,
  userEmail,
  blocked,
  storeId,
  role,
  unread,
  stores,
}: {
  children: React.ReactNode;
  storeName: string;
  storeSlug: string;
  userEmail: string;
  blocked: boolean;
  storeId: string;
  role: "owner" | "staff";
  unread: number;
  stores: { id: string; name: string; role: "owner" | "staff" }[];
}) {
  const [open, setOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const isOwner = role === "owner";
  // Una sola campana montada (una sola suscripción en tiempo real): en el menú en escritorio, en el encabezado en celular.
  const isDesktop = useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia("(min-width: 768px)");
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia("(min-width: 768px)").matches,
    () => null,
  );
  const bell = <NotificationBell storeId={storeId} initialUnread={unread} />;
  const openSearch = () => {
    setOpen(false);
    setSearchOpen(true);
  };

  // El menú usa la variante oscura (grafito): `dark` cambia los colores solo dentro de él.
  const sidebar = (
    <div className="dark flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex flex-col gap-3 px-4 pt-4 pb-3">
        <div className="flex items-center justify-between gap-2">
          <Link href={isOwner ? "/dashboard" : "/dashboard/pedidos"} onClick={() => setOpen(false)} aria-label="Vendia, ir al inicio">
            <BrandLogo tone="light" />
          </Link>
          {isDesktop === true ? bell : null}
        </div>
        <div className="min-w-0 rounded-lg bg-white/[0.04] px-2.5 py-2">
          <StoreSwitcher current={storeId} currentName={storeName} stores={stores} />
          <p className="truncate text-xs text-muted-foreground">
            /p/{storeSlug}
            {isOwner ? null : <span className="text-sky-300"> · Confirmador</span>}
          </p>
        </div>
        <SearchButton onOpen={openSearch} />
      </div>
      <div className="flex-1 overflow-y-auto px-3 pb-3">
        <Nav onNavigate={() => setOpen(false)} isOwner={isOwner} />
      </div>
      <div className="flex flex-col gap-0.5 border-t border-sidebar-border p-3">
        <NavLink item={HELP_ITEM} onNavigate={() => setOpen(false)} />
        <p className="truncate px-3 pt-1 text-xs text-muted-foreground">{userEmail}</p>
        <form action={logout}>
          <button
            type="submit"
            className="flex w-full items-center gap-3 rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-white"
          >
            <LogOut className="size-4" /> Cerrar sesión
          </button>
        </form>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-svh w-full bg-canvas">
      <aside className="sticky top-0 hidden h-svh w-60 shrink-0 md:block">{sidebar}</aside>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="dark w-72 border-none bg-sidebar p-0 text-sidebar-foreground">
          <SheetTitle className="sr-only">Menú</SheetTitle>
          {sidebar}
        </SheetContent>
      </Sheet>
      <CommandMenu open={searchOpen} onOpenChange={setSearchOpen} isOwner={isOwner} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur md:hidden">
          <Link href={isOwner ? "/dashboard" : "/dashboard/pedidos"} className="flex-1" aria-label="Vendia, ir al inicio">
            <BrandLogo />
          </Link>
          <SearchButton onOpen={openSearch} compact />
          {isDesktop === false ? bell : null}
        </header>
        {blocked ? (
          <div className="border-b bg-destructive/10 px-4 py-2 text-sm text-destructive">
            Tu tienda está bloqueada: tus landings no reciben pedidos. Contacta a soporte.
          </div>
        ) : null}
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-6 pb-24 md:px-8 md:py-8">{children}</main>
      </div>
      <BottomNav isOwner={isOwner} onMore={() => setOpen(true)} />
    </div>
  );
}
