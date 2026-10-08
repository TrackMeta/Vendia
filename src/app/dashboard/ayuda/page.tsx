import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/dashboard/page-header";
import { requireStore } from "@/lib/auth";
import { ShowWelcomeButton } from "./show-welcome";

export const metadata: Metadata = { title: "Ayuda" };

type Guide = { title: string; steps: string[]; link?: { href: string; label: string } };

const GUIDES: Guide[] = [
  {
    title: "Cómo empezar",
    steps: [
      "Configuración: pon tu WhatsApp, el envío a Lima y provincia, y el adelanto de provincia.",
      "Productos: crea el producto con fotos, tu costo y sus ofertas (1 unidad, 2 unidades…).",
      "Landing Pages: elige una plantilla (Clásica, Video primero, Packs o Product page), edítala y publícala.",
      "Marketing: conecta Meta y pega la plantilla de URL en tus anuncios.",
    ],
    link: { href: "/dashboard/configuracion", label: "Ir a Configuración" },
  },
  {
    title: "Confirmar pedidos",
    steps: [
      "Logística → «Por confirmar»: llama (Llamada 1, 2, 3) y luego WhatsApp, uno tras otro.",
      "Registra el resultado de cada intento. Puedes cancelar desde el primer intento, con su motivo.",
      "En provincia, al confirmar te pedirá el DNI y la agencia Shalom donde recogerá el cliente.",
      "Si termina la secuencia sin respuesta, Vendia te avisa (no cancela solo).",
    ],
    link: { href: "/dashboard/logistica", label: "Ir a Logística" },
  },
  {
    title: "Despachar y exportar al courier",
    steps: [
      "Logística → «Por despachar» → «Exportar a courier».",
      "Elige Eva (Lima) o Shalom (provincia). Vendia revisa que no falte DNI, agencia o distrito.",
      "Se descarga el Excel oficial del courier listo para su carga masiva. Cada pedido se exporta una sola vez.",
      "Si se te perdió el archivo, descárgalo de nuevo en «Lotes exportados».",
    ],
  },
  {
    title: "Provincia (Shalom)",
    steps: [
      "El cliente paga un adelanto antes del envío; registra el pago y su comprobante en el pedido.",
      "Estados: Enviado → En agencia → Cobrado (pagó el saldo) → Entregado (recogió con DNI y clave).",
      "La clave de recojo se guarda en el pedido y solo la ve tu equipo.",
    ],
  },
  {
    title: "Venta real y CPA real",
    steps: [
      "Un pedido no es una venta. En Configuración eliges cuándo cuenta: Lima Entregado y Provincia Cobrado, o Entregado en ambas.",
      "CPA real = gasto en publicidad ÷ ventas reales. Lo ves en Inicio y en Rendimiento junto al costo por resultado de Meta.",
      "Si tu cuenta publicitaria está en dólares, pon el tipo de cambio y si sumas IGV.",
    ],
    link: { href: "/dashboard/rendimiento", label: "Ir a Rendimiento" },
  },
  {
    title: "Vender más en tu landing",
    steps: [
      "Formulario → «Productos adicionales»: casillas que suben el ticket (order bumps).",
      "Editor → Ventas: oferta de un clic en la página de gracias, botón de WhatsApp, ángulo creativo y prueba A/B.",
      "Abandonados: personas que dejaron su celular y no terminaron; escríbeles por WhatsApp.",
    ],
    link: { href: "/dashboard/abandonados", label: "Ver abandonados" },
  },
  {
    title: "Equipo, tiendas y dominios",
    steps: [
      "Equipo: invita confirmadores. Ven pedidos, logística y clientes, pero no gastos ni configuración.",
      "Puedes tener varias tiendas: cámbialas con el selector arriba a la izquierda.",
      "Dominios: usa tu propio dominio para tus landings (uno por tienda o uno para todas).",
    ],
    link: { href: "/dashboard/dominios", label: "Ir a Dominios" },
  },
];

const GLOSSARY: [string, string][] = [
  ["COD", "Contraentrega: el cliente paga al recibir."],
  ["CPA real", "Lo que te cuesta en publicidad cada venta real (no cada pedido)."],
  ["ROAS real", "Ventas reales ÷ gasto en publicidad."],
  ["Order bump", "Producto adicional que el cliente marca en el formulario antes de pedir."],
  ["Upsell", "Oferta que se suma al mismo pedido en la página de gracias."],
  ["Ángulo creativo", "El enfoque del anuncio y su landing: «dolor de espalda», «postparto»…"],
  ["Prueba A/B", "Un mismo link reparte las visitas entre varias landings para ver cuál vende más."],
];

export default async function HelpPage() {
  const { store } = await requireStore();
  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader title="Ayuda" description="Guías cortas para sacarle el jugo a Vendia." />
      {store.role === "owner" ? <ShowWelcomeButton /> : null}
      <div className="grid gap-4 md:grid-cols-2">
        {GUIDES.map((g) => (
          <section key={g.title} className="flex flex-col gap-2 rounded-xl border p-4">
            <h2 className="font-semibold">{g.title}</h2>
            <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
              {g.steps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
            {g.link ? (
              <Link href={g.link.href} className="mt-auto w-fit text-sm text-primary hover:underline">
                {g.link.label} →
              </Link>
            ) : null}
          </section>
        ))}
      </div>
      <section className="flex flex-col gap-2 rounded-xl border p-4">
        <h2 className="font-semibold">Glosario</h2>
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          {GLOSSARY.map(([term, def]) => (
            <div key={term}>
              <dt className="font-medium">{term}</dt>
              <dd className="text-muted-foreground">{def}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
