// Pestañas de Configuración: compartidas entre la página (servidor) y el formulario (cliente)

export const SETTINGS_TABS = [
  { id: "tienda", label: "Tienda", description: "Nombre, contacto, logo y el mensaje que ve tu cliente al terminar su pedido." },
  { id: "envios", label: "Envíos y adelanto", description: "Cuánto cobras de envío en Lima y provincia, el adelanto, el embalaje y cómo te pagan." },
  { id: "couriers", label: "Couriers", description: "Con quién despachas y cuánto te cobra cada courier. Cada uno se guarda por separado." },
  { id: "publicidad", label: "Publicidad", description: "Moneda de tu cuenta de anuncios, tipo de cambio e IGV para calcular tu gasto real." },
  { id: "pedidos", label: "Pedidos", description: "Cómo se confirma cada pedido, cuándo cuenta como venta y quién te ayuda." },
] as const;

export type SettingsTabId = (typeof SETTINGS_TABS)[number]["id"];

export const DEFAULT_SETTINGS_TAB: SettingsTabId = "tienda";

/** Lee ?tab= de la URL; si no es válido, abre «Tienda». */
export function parseSettingsTab(value: unknown): SettingsTabId {
  return SETTINGS_TABS.find((t) => t.id === value)?.id ?? DEFAULT_SETTINGS_TAB;
}

/** En qué pestaña está cada campo del formulario (para llevar al usuario al error). */
export const FIELD_TAB: Record<string, SettingsTabId> = {
  name: "tienda",
  whatsapp: "tienda",
  phone: "tienda",
  email: "tienda",
  address: "tienda",
  logo_path: "tienda",
  favicon_path: "tienda",
  confirmation_message: "tienda",
  shipping_lima: "envios",
  shipping_province: "envios",
  advance_amount: "envios",
  packaging_cost: "envios",
  payment_methods: "envios",
  ad_currency: "publicidad",
  usd_rate: "publicidad",
  apply_igv: "publicidad",
  contact_calls: "pedidos",
  contact_whatsapp: "pedidos",
  real_sale_mode: "pedidos",
};

export const tabLabel = (id: SettingsTabId) => SETTINGS_TABS.find((t) => t.id === id)?.label ?? "";
