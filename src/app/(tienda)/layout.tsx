import type { Metadata, Viewport } from "next";
import type { CSSProperties } from "react";
import { ErrorListener } from "@/components/error-listener";
import "../globals.css";

/**
 * Base de las landings (aparte del panel). Lo menos posible: cada archivo que pide el navegador
 * es un pedido a Vercel por visita. Sin las letras del panel (la landing trae la suya), sin avisos
 * (toasts), sin el puente de la app del celular y sin el «instalar Vendia».
 */

// Ícono de la pestaña escrito dentro de la página: el navegador no tiene que pedir /favicon.ico.
// Si la tienda subió su ícono, la landing usa ese (ver p/[store]/[slug]/page.tsx).
const BAG_ICON =
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#202124"/><path d="M10 12h12l-1 12H11z" fill="none" stroke="#fff" stroke-width="2" stroke-linejoin="round"/><path d="M13 12a3 3 0 0 1 6 0" fill="none" stroke="#fff" stroke-width="2"/></svg>`,
  );

export const metadata: Metadata = {
  icons: { icon: BAG_ICON },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

// Letras del sistema del celular (no se descargan); el contador usa la de números del sistema
const FONTS = {
  "--font-sans": "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  "--font-geist-mono": "ui-monospace, SFMono-Regular, Menlo, monospace",
} as CSSProperties;

export default function StoreLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className="h-full antialiased" style={FONTS}>
      <body className="min-h-full flex flex-col">
        {children}
        <ErrorListener />
      </body>
    </html>
  );
}
