/**
 * Arquitectura de integraciones: Vendia es la fuente de verdad de los pedidos.
 * Cada proveedor es un "adaptador" con capacidades declaradas. No se inventan APIs:
 * si un proveedor no publica una API, se marca como no disponible y se usa la exportación.
 */

export type IntegrationCapabilities = {
  /** Enviar pedidos al proveedor por API */
  createOrder: boolean;
  /** Recibir cambios de estado por webhook */
  webhooks: boolean;
  /** Exportar pedidos en archivo (Excel/CSV) */
  export: boolean;
};

export type IntegrationProvider = {
  id: string;
  name: string;
  description: string;
  available: boolean;
  capabilities: IntegrationCapabilities;
  /** Por qué no está disponible (con fuente verificada) */
  unavailableReason?: string;
  docsUrl?: string;
};

export const INTEGRATION_PROVIDERS: IntegrationProvider[] = [
  {
    id: "generic_webhook",
    name: "Webhook genérico",
    description:
      "Cualquier courier, motorizado o automatización (Make, Zapier, n8n) puede actualizar el estado de tus pedidos enviando un webhook firmado a Vendia.",
    available: true,
    capabilities: { createOrder: false, webhooks: true, export: false },
  },
  {
    id: "csv_export",
    name: "Exportación para courier (Excel/CSV)",
    description: "Descarga tus pedidos confirmados con nombre, celular, ubigeo, dirección, referencia y monto a cobrar.",
    available: true,
    capabilities: { createOrder: false, webhooks: false, export: true },
  },
  {
    id: "releasit",
    name: "Releasit",
    description: "Formulario COD para Shopify.",
    available: false,
    capabilities: { createOrder: false, webhooks: false, export: false },
    unavailableReason:
      "Releasit es una app de formularios para Shopify/Tiendanube y no publica una API ni webhooks para plataformas externas (verificado en releas.it y su centro de ayuda). Vendia ya incluye su propio formulario COD.",
    docsUrl: "https://help.releas.it/en/",
  },
  {
    id: "shalom",
    name: "Shalom",
    description: "Courier nacional.",
    available: false,
    capabilities: { createOrder: false, webhooks: false, export: false },
    unavailableReason: "No encontramos una API pública documentada. Usa la exportación Excel/CSV o el webhook genérico.",
  },
  {
    id: "olva",
    name: "Olva Courier",
    description: "Courier nacional.",
    available: false,
    capabilities: { createOrder: false, webhooks: false, export: false },
    unavailableReason: "No encontramos una API pública documentada. Usa la exportación Excel/CSV o el webhook genérico.",
  },
];

export function getProvider(id: string): IntegrationProvider | undefined {
  return INTEGRATION_PROVIDERS.find((p) => p.id === id);
}
