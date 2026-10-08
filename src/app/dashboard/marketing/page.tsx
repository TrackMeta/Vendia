import type { Metadata } from "next";
import { ComingSoon } from "@/components/dashboard/page-header";

export const metadata: Metadata = { title: "Marketing" };

export default function MarketingPage() {
  return (
    <ComingSoon title="Marketing" phase="Fase 2 · Meta Pixel + Conversions API">
      <p>Aquí conectarás tu Meta Pixel y el token de Conversions API de tu tienda.</p>
      <ul className="mt-2 list-disc pl-5">
        <li>PageView, ViewContent e InitiateCheckout desde la landing.</li>
        <li>Lead al enviar el formulario (navegador + servidor, deduplicado con el mismo event_id).</li>
        <li>Purchase solo cuando el pedido llega al estado de venta real (por defecto Entregado), enviado desde el servidor.</li>
      </ul>
      <p className="mt-2">
        Desde hoy ya se guardan en cada pedido los UTM, el fbclid/fbc y los IDs de campaña, conjunto y anuncio, así que no se pierde
        ningún dato de atribución. Usa esta plantilla de URL en tus anuncios:
      </p>
      <code className="mt-2 block rounded-md bg-muted p-2 text-xs break-all">
        ?utm_source=facebook&amp;utm_medium=paid&amp;utm_campaign={"{{campaign.name}}"}&amp;utm_content={"{{ad.name}}"}&amp;utm_term={"{{adset.name}}"}&amp;campaign_id={"{{campaign.id}}"}&amp;adset_id={"{{adset.id}}"}&amp;ad_id={"{{ad.id}}"}
      </code>
    </ComingSoon>
  );
}
