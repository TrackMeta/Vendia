import type { Metadata } from "next";
import { ComingSoon } from "@/components/dashboard/page-header";

export const metadata: Metadata = { title: "Integraciones" };

export default function IntegrationsPage() {
  return (
    <ComingSoon title="Integraciones" phase="Fase 3 · Logística">
      <p>
        Releasit no ofrece una API pública (es una app de formularios para Shopify), por eso la confirmación y la logística se manejan
        dentro de Vendia. Aquí se conectarán couriers (Shalom, Olva, motorizados) cuando ofrezcan API, y mientras tanto podrás exportar
        tus pedidos en el formato de cada courier.
      </p>
    </ComingSoon>
  );
}
