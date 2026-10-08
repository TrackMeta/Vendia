import type { Metadata } from "next";
import { ComingSoon } from "@/components/dashboard/page-header";

export const metadata: Metadata = { title: "Analítica" };

export default function AnalyticsPage() {
  return (
    <ComingSoon title="Analítica" phase="Fase 4 · Funnel y rentabilidad">
      <p>
        Funnel completo (visitas → formulario → pedidos → confirmados → enviados → entregados), y tablas por campaña, producto y
        departamento/provincia/distrito con CPA, ROAS, tasa de entrega y utilidad. Los datos ya se están guardando con cada pedido.
      </p>
    </ComingSoon>
  );
}
