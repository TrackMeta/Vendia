import type { Metadata } from "next";
import { ComingSoon } from "@/components/dashboard/page-header";

export const metadata: Metadata = { title: "Gastos" };

export default function ExpensesPage() {
  return (
    <ComingSoon title="Gastos" phase="Próxima fase · Gastos y utilidad">
      <p>
        Registrarás tu gasto en Meta Ads, TikTok, Google, producto, courier, devoluciones, WhatsApp, software y otros, por fecha y
        opcionalmente por campaña o producto. Con eso se calculan el CPA por pedido entregado, el ROAS real y tu utilidad real en el
        Inicio.
      </p>
    </ComingSoon>
  );
}
