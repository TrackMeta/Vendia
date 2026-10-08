"use client";

import {
  BarChart3,
  Home,
  LayoutTemplate,
  LogOut,
  Megaphone,
  Menu,
  Package,
  Plug,
  Receipt,
  Settings,
  ShoppingBag,
  Truck,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { logout } from "@/app/(auth)/actions";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

const NAV: { href: string; label: string; icon: typeof Home; exact?: boolean; soon?: boolean }[] = [
  { href: "/dashboard", label: "Inicio", icon: Home, exact: true },
  { href: "/dashboard/pedidos", label: "Pedidos", icon: ShoppingBag },
  { href: "/dashboard/logistica", label: "Logística", icon: Truck },
  { href: "/dashboard/productos", label: "Productos", icon: Package },
  { href: "/dashboard/landings", label: "Landing Pages", icon: LayoutTemplate },
  { href: "/dashboard/clientes", label: "Clientes", icon: Users },
  { href: "/dashboard/marketing", label: "Marketing", icon: Megaphone },
  { href: "/dashboard/gastos", label: "Gastos", icon: Receipt },
  { href: "/dashboard/analitica", label: "Analítica", icon: BarChart3 },
  { href: "/dashboard/integraciones", label: "Integraciones", icon: Plug },
  { href: "/dashboard/configuracion", label: "Configuración", icon: Settings },
];

function Nav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-0.5">
      {NAV.map((item) => {
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
}: {
  children: React.ReactNode;
  storeName: string;
  storeSlug: string;
  userEmail: string;
  blocked: boolean;
}) {
  const [open, setOpen] = useState(false);

  const sidebar = (
    <div className="flex h-full flex-col gap-6 p-4">
      <div className="px-3">
        <p className="text-lg font-semibold tracking-tight">Vendia</p>
        <p className="truncate text-xs text-muted-foreground">
          {storeName} · /p/{storeSlug}
        </p>
      </div>
      <Nav onNavigate={() => setOpen(false)} />
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
          <span className="font-semibold">Vendia</span>
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
