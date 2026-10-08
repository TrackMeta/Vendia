"use client";

import {
  BarChart3,
  Bell,
  Globe,
  Home,
  LayoutTemplate,
  LifeBuoy,
  LogOut,
  Megaphone,
  Menu,
  MousePointerClick,
  Package,
  Plug,
  Receipt,
  Settings,
  ShoppingBag,
  TrendingUp,
  Trophy,
  Truck,
  UserCog,
  Users,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { logout } from "@/app/(auth)/actions";
import { NotificationBell } from "@/components/dashboard/notifications";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { StoreSwitcher } from "./store-switcher";
import { cn } from "@/lib/utils";

type NavItem = { href: string; label: string; icon: typeof Home; exact?: boolean; soon?: boolean; ownerOnly?: boolean; staffOnly?: boolean };

const NAV: NavItem[] = [
  { href: "/dashboard", label: "Inicio", icon: Home, exact: true, ownerOnly: true },
  { href: "/dashboard/pedidos", label: "Pedidos", icon: ShoppingBag },
  { href: "/dashboard/logistica", label: "Logística", icon: Truck },
  { href: "/dashboard/abandonados", label: "Abandonados", icon: MousePointerClick },
  { href: "/dashboard/liquidacion", label: "Liquidación", icon: Wallet, ownerOnly: true },
  { href: "/dashboard/mi-rendimiento", label: "Mi rendimiento", icon: Trophy, staffOnly: true },
  { href: "/dashboard/productos", label: "Productos", icon: Package, ownerOnly: true },
  { href: "/dashboard/landings", label: "Landing Pages", icon: LayoutTemplate, ownerOnly: true },
  { href: "/dashboard/clientes", label: "Clientes", icon: Users },
  { href: "/dashboard/notificaciones", label: "Notificaciones", icon: Bell },
  { href: "/dashboard/marketing", label: "Marketing", icon: Megaphone, ownerOnly: true },
  { href: "/dashboard/gastos", label: "Gastos", icon: Receipt, ownerOnly: true },
  { href: "/dashboard/rendimiento", label: "Rendimiento", icon: TrendingUp, ownerOnly: true },
  { href: "/dashboard/analitica", label: "Analítica", icon: BarChart3, ownerOnly: true },
  { href: "/dashboard/integraciones", label: "Integraciones", icon: Plug, ownerOnly: true },
  { href: "/dashboard/dominios", label: "Dominios", icon: Globe, ownerOnly: true },
  { href: "/dashboard/equipo", label: "Equipo", icon: UserCog, ownerOnly: true },
  { href: "/dashboard/configuracion", label: "Configuración", icon: Settings, ownerOnly: true },
  { href: "/dashboard/ayuda", label: "Ayuda", icon: LifeBuoy },
];

function Nav({ onNavigate, isOwner }: { onNavigate?: () => void; isOwner: boolean }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-0.5">
      {NAV.filter((item) => (isOwner ? !item.staffOnly : !item.ownerOnly)).map((item) => {
        const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
              active && "bg-muted font-medium text-foreground",
            )}
          >
            <item.icon className="size-4" />
            <span className="flex-1">{item.label}</span>
            {item.soon ? <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Pronto</span> : null}
          </Link>
        );
      })}
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

  const sidebar = (
    <div className="flex h-full flex-col gap-6 p-4">
      <div className="flex items-start justify-between gap-2 px-3">
        <div className="min-w-0">
          <p className="text-lg font-semibold tracking-tight">Vendia</p>
          <StoreSwitcher current={storeId} currentName={storeName} stores={stores} />
          <p className="truncate text-xs text-muted-foreground">/p/{storeSlug}</p>
          {role === "staff" ? <p className="text-xs font-medium text-sky-600">Confirmador</p> : null}
        </div>
        {isDesktop === true ? bell : null}
      </div>
      <Nav onNavigate={() => setOpen(false)} isOwner={role === "owner"} />
      <div className="mt-auto flex flex-col gap-2 border-t pt-4">
        <p className="truncate px-3 text-xs text-muted-foreground">{userEmail}</p>
        <form action={logout}>
          <button
            type="submit"
            className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <LogOut className="size-4" /> Cerrar sesión
          </button>
        </form>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-svh w-full">
      <aside className="sticky top-0 hidden h-svh w-60 shrink-0 border-r bg-background md:block">{sidebar}</aside>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="w-64 p-0">
          <SheetTitle className="sr-only">Menú</SheetTitle>
          {sidebar}
        </SheetContent>
      </Sheet>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur md:hidden">
          <button type="button" onClick={() => setOpen(true)} aria-label="Abrir menú" className="rounded-md p-1.5 hover:bg-muted">
            <Menu className="size-5" />
          </button>
          <span className="flex-1 font-semibold">Vendia</span>
          {isDesktop === false ? bell : null}
        </header>
        {blocked ? (
          <div className="border-b bg-destructive/10 px-4 py-2 text-sm text-destructive">
            Tu tienda está bloqueada: tus landings no reciben pedidos. Contacta a soporte.
          </div>
        ) : null}
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 md:px-8 md:py-8">{children}</main>
      </div>
    </div>
  );
}
