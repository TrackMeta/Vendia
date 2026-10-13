import type { MetadataRoute } from "next";

/**
 * Vendia como app instalable (PWA): el equipo la agrega a la pantalla de inicio del celular
 * y se abre a pantalla completa, sin la barra del navegador.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
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
}
