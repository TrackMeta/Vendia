import type { MetadataRoute } from "next";

/**
 * Vendia como app instalable (PWA): el equipo la agrega a la pantalla de inicio del celular
 * y se abre a pantalla completa, sin la barra del navegador.
 * Es una ruta (y no app/manifest.ts) para que solo el panel la enlace: las landings de las
 * tiendas no la piden (un pedido menos a Vercel por visita). El enlace está en (panel)/layout.tsx.
 */
export const dynamic = "force-static";

const manifest: MetadataRoute.Manifest = {
  name: "Vendia",
  short_name: "Vendia",
  description: "Pedidos contraentrega: confirma, despacha y mide tus ventas reales.",
  start_url: "/dashboard/pedidos",
  scope: "/",
  display: "standalone",
  orientation: "portrait",
  background_color: "#f3f4f6",
  theme_color: "#202124",
  lang: "es-PE",
  // Computadora: la «V» sin fondo. Android usa la «maskable» (con fondo: recorta el ícono en círculo o cuadrado)
  icons: [
    { src: "/icons/app-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "/icons/app-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    { src: "/icons/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
  ],
  shortcuts: [
    { name: "Por confirmar", url: "/dashboard/logistica?vista=confirmar" },
    { name: "Pedidos", url: "/dashboard/pedidos" },
    { name: "Nuevo pedido", url: "/dashboard/pedidos/nuevo" },
  ],
};

export function GET() {
  return new Response(JSON.stringify(manifest), { headers: { "Content-Type": "application/manifest+json" } });
}
