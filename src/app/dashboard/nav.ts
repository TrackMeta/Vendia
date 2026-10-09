import {
  BarChart3,
  Globe,
  Home,
  LayoutTemplate,
  LifeBuoy,
  Megaphone,
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

export type NavItem = {
  href: string;
  label: string;
  icon: typeof Home;
  /** Coincidencia exacta de ruta (Inicio), si no, por prefijo. */
  exact?: boolean;
  ownerOnly?: boolean;
  staffOnly?: boolean;
  /** Palabras extra para el buscador (Ctrl+K). */
  keywords?: string;
};

export type NavGroup = { label: string | null; items: NavItem[] };

/** Menú agrupado por tarea: lo que se usa todos los días arriba, los ajustes al final. */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: null,
    items: [
      { href: "/dashboard", label: "Inicio", icon: Home, exact: true, ownerOnly: true, keywords: "resumen dashboard utilidad" },
      { href: "/dashboard/mi-rendimiento", label: "Mi rendimiento", icon: Trophy, staffOnly: true, keywords: "comisiones" },
    ],
  },
  {
    label: "Operación",
    items: [
      { href: "/dashboard/pedidos", label: "Pedidos", icon: ShoppingBag, keywords: "ordenes ventas" },
      { href: "/dashboard/logistica", label: "Logística", icon: Truck, keywords: "confirmar despachar courier envios rotulos" },
      { href: "/dashboard/abandonados", label: "Abandonados", icon: MousePointerClick, keywords: "carritos recuperar" },
      { href: "/dashboard/clientes", label: "Clientes", icon: Users },
      { href: "/dashboard/liquidacion", label: "Liquidación", icon: Wallet, ownerOnly: true, keywords: "courier cobrar deposito" },
    ],
  },
  {
    label: "Ventas",
    items: [
      { href: "/dashboard/productos", label: "Productos", icon: Package, ownerOnly: true, keywords: "stock variantes ofertas" },
      { href: "/dashboard/landings", label: "Landings", icon: LayoutTemplate, ownerOnly: true, keywords: "paginas tienda" },
      { href: "/dashboard/marketing", label: "Marketing", icon: Megaphone, ownerOnly: true, keywords: "meta pixel tiktok facebook" },
    ],
  },
  {
    label: "Números",
    items: [
      { href: "/dashboard/rendimiento", label: "Rendimiento", icon: TrendingUp, ownerOnly: true, keywords: "campañas anuncios roas" },
      { href: "/dashboard/analitica", label: "Analítica", icon: BarChart3, ownerOnly: true, keywords: "embudo visitas" },
      { href: "/dashboard/gastos", label: "Gastos", icon: Receipt, ownerOnly: true, keywords: "publicidad egresos" },
    ],
  },
  {
    label: "Ajustes",
    items: [
      { href: "/dashboard/equipo", label: "Equipo", icon: UserCog, ownerOnly: true, keywords: "confirmadores comisiones invitar" },
      { href: "/dashboard/integraciones", label: "Integraciones", icon: Plug, ownerOnly: true, keywords: "webhook api" },
      { href: "/dashboard/dominios", label: "Dominios", icon: Globe, ownerOnly: true },
      { href: "/dashboard/configuracion", label: "Configuración", icon: Settings, ownerOnly: true, keywords: "whatsapp embalaje envio" },
    ],
  },
];

export const HELP_ITEM: NavItem = { href: "/dashboard/ayuda", label: "Ayuda", icon: LifeBuoy, keywords: "soporte guia" };

export function visibleGroups(isOwner: boolean): NavGroup[] {
  return NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => (isOwner ? !i.staffOnly : !i.ownerOnly)) })).filter((g) => g.items.length > 0);
}

export function isActive(item: NavItem, pathname: string): boolean {
  return item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
}
