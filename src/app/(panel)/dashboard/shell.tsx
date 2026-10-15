"use client";

import { ArrowLeftRight, Bell, Home, LogOut, Menu, ShoppingBag, Trophy, Truck, Users } from "lucide-react";
import Link, { useLinkStatus } from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { logout } from "@/app/(panel)/(auth)/actions";
import { BrandLogo } from "@/components/brand";
import { NotificationBell } from "@/components/dashboard/notifications";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import type { ThemePref } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { forgetPushDevice } from "@/modules/app-native/push";
import { CommandMenu, SearchButton } from "./command-menu";
import { isNativeApp } from "@/modules/app-native/client";
import { APP_ITEM, HELP_ITEM, isActive, type NavItem, visibleGroups } from "./nav";
import { StoreSwitcher } from "./store-switcher";
import { ThemeToggle, useEffectiveDark } from "./theme-toggle";

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

/** Rayita roja arriba de la pestaña tocada mientras carga su sección (siempre ocupa su lugar: no mueve nada). */
function TabPending() {
  const { pending } = useLinkStatus();
  return <span aria-hidden className={cn("absolute inset-x-4 top-0 h-0.5 rounded-full bg-primary transition-opacity", pending ? "animate-pulse opacity-100" : "opacity-0")} />;
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
            // Precarga normal (pocas pestañas): al tocar, la sección aparece al instante con su esqueleto
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn("relative flex min-w-0 flex-1 flex-col items-center gap-0.5 py-2 text-[11px] text-muted-foreground", active && "font-medium text-primary")}
            >
              <TabPending />
              <item.icon className="size-5" />
              <span className="truncate">{item.label}</span>
            </Link>
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

/** Tienda activa en este navegador: si otra pestaña cambia de tienda, esta se entera. */
const ACTIVE_STORE_KEY = "vd_active_store";

/**
 * Otra pestaña cambió de tienda: lo que se guarde aquí iría a la tienda nueva (Vendia guarda en la
 * tienda elegida al último). Se bloquea esta pestaña hasta recargarla, para no mezclar tiendas.
 */
function useStoreChangedElsewhere(storeId: string): boolean {
  const [changed, setChanged] = useState(false);
  useEffect(() => {
    try {
      localStorage.setItem(ACTIVE_STORE_KEY, storeId);
    } catch {}
    const onStorage = (e: StorageEvent) => {
      if (e.key === ACTIVE_STORE_KEY && e.newValue) setChanged(e.newValue !== storeId);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [storeId]);
  return changed;
}

function StoreChangedNotice({ storeName }: { storeName: string }) {
  return (
    <div role="alertdialog" aria-modal="true" aria-labelledby="otra-tienda-titulo" className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
      <div className="flex w-full max-w-sm flex-col gap-3 rounded-2xl bg-background p-5 text-foreground shadow-xl ring-1 ring-foreground/10">
        <span className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
          <ArrowLeftRight className="size-5" aria-hidden />
        </span>
        <h2 id="otra-tienda-titulo" className="text-base font-semibold">
          Cambiaste de tienda en otra pestaña
        </h2>
        <p className="text-sm text-muted-foreground">
          Esta pestaña todavía muestra «{storeName}». Recárgala para no guardar cambios en la tienda equivocada.
        </p>
        <button type="button" onClick={() => window.location.reload()} className="h-10 rounded-lg bg-primary text-sm font-medium text-primary-foreground hover:bg-primary/90">
          Recargar esta pestaña
        </button>
      </div>
    </div>
  );
}

/** Lo que se usa en la calle, en el «Más» del celular (lo de la barra de abajo no se repite). */
const MORE_HREFS = ["/dashboard/abandonados", "/dashboard/rendimiento", "/dashboard/gastos", "/dashboard/liquidacion"];
const NOTIFICATIONS_ITEM: NavItem = { href: "/dashboard/notificaciones", label: "Notificaciones", icon: Bell };

/** Cerrar sesión. En la app de celular, ese celular deja de recibir avisos de esta cuenta. */
async function logoutHere() {
  await forgetPushDevice();
  await logout();
}

/**
 * «Más» en el celular: hoja blanca que sube desde abajo con la tienda, botones grandes,
 * el tema y cerrar sesión (el menú grafito queda para la computadora).
 */
function MoreSheet({
  open,
  onOpenChange,
  isOwner,
  themePref,
  onThemeChange,
  switcher,
  inApp,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isOwner: boolean;
  themePref: ThemePref;
  onThemeChange: (pref: ThemePref) => void;
  switcher: React.ReactNode;
  /** Dentro de la app de celular no se ofrece descargarla. */
  inApp: boolean | null;
}) {
  const pathname = usePathname();
  const all = visibleGroups(isOwner).flatMap((g) => g.items);
  const items = [...MORE_HREFS.map((href) => all.find((i) => i.href === href)).filter((i): i is NavItem => Boolean(i)), NOTIFICATIONS_ITEM, ...(inApp === false ? [APP_ITEM] : [])];
  const close = () => onOpenChange(false);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" showCloseButton={false} className="gap-0 rounded-t-2xl border-none px-4 pt-2 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
        <SheetTitle className="sr-only">Más</SheetTitle>
        <div aria-hidden className="mx-auto mb-3 h-1 w-9 rounded-full bg-foreground/15" />
        {switcher}
        <nav className="mt-3 grid grid-cols-3 gap-2" aria-label="Más secciones">
          {items.map((item) => {
            const active = isActive(item, pathname);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={close}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex flex-col items-center gap-1.5 rounded-xl bg-muted px-1 py-3.5 text-center text-xs transition-colors active:bg-muted/70",
                  active && "font-medium ring-1 ring-primary/40",
                )}
              >
                <item.icon className="size-6 text-primary" />
                <span className="truncate">{item.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="mt-4 flex flex-col gap-2 border-t pt-3">
          <ThemeToggle value={themePref} onChange={onThemeChange} light />
          <form action={logoutHere} className="self-center">
            <button type="submit" className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-primary active:bg-primary/10">
              <LogOut className="size-4" /> Cerrar sesión
            </button>
          </form>
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function DashboardShell({
  children,
  storeName,
  userEmail,
  blocked,
  storeId,
  role,
  unread,
  stores,
  storeLogo,
  theme,
}: {
  children: React.ReactNode;
  storeName: string;
  userEmail: string;
  blocked: boolean;
  storeId: string;
  role: "owner" | "staff";
  unread: number;
  stores: { id: string; name: string; role: "owner" | "staff"; logo: string | null }[];
  storeLogo: string | null;
  theme: ThemePref;
}) {
  const [open, setOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const storeChangedElsewhere = useStoreChangedElsewhere(storeId);
  const isOwner = role === "owner";
  const [themePref, setThemePref] = useState<ThemePref>(theme);
  const dark = useEffectiveDark(themePref);
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
  // Dentro de la app de celular no se ofrece descargarla
  const inApp = useSyncExternalStore(
    () => () => {},
    isNativeApp,
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
        <StoreSwitcher current={storeId} currentName={storeName} currentLogo={storeLogo} isOwner={isOwner} stores={stores} />
        <SearchButton onOpen={openSearch} />
      </div>
      <div className="vd-sidebar-scroll flex-1 overflow-y-auto pr-1.5 pb-3 pl-3">
        <Nav onNavigate={() => setOpen(false)} isOwner={isOwner} />
      </div>
      <div className="flex flex-col gap-0.5 border-t border-sidebar-border p-3">
        {inApp === false ? <NavLink item={APP_ITEM} onNavigate={() => setOpen(false)} /> : null}
        <NavLink item={HELP_ITEM} onNavigate={() => setOpen(false)} />
        <div className="px-3 pt-1 pb-1">
          <ThemeToggle value={themePref} onChange={setThemePref} />
        </div>
        <p className="truncate px-3 text-xs text-muted-foreground">{userEmail}</p>
        <form action={logoutHere}>
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
    <div data-vd-shell className={cn("flex min-h-svh w-full bg-canvas text-foreground", dark && "dark")}>
      <aside className="sticky top-0 hidden h-svh w-60 shrink-0 md:block">{sidebar}</aside>
      <MoreSheet
        open={open}
        onOpenChange={setOpen}
        isOwner={isOwner}
        themePref={themePref}
        onThemeChange={setThemePref}
        inApp={inApp}
        switcher={<StoreSwitcher current={storeId} currentName={storeName} currentLogo={storeLogo} isOwner={isOwner} stores={stores} light />}
      />
      <CommandMenu open={searchOpen} onOpenChange={setSearchOpen} isOwner={isOwner} phone={isDesktop === false} />
      {storeChangedElsewhere ? <StoreChangedNotice storeName={storeName} /> : null}
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
