import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ErrorListener } from "@/components/error-listener";
import { NativeBridge } from "@/components/native-bridge";
import { Toaster } from "@/components/ui/sonner";
import "../globals.css";

const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: { default: "Vendia", template: "%s · Vendia" },
  description: "Landing pages y pedidos contraentrega para vendedores en Perú.",
  // App instalable en el celular (ver app/manifest.webmanifest/route.ts)
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Vendia", statusBarStyle: "default" },
  icons: {
    // Pestaña del navegador: la «V» sin fondo. En el celular (apple / app instalada) se queda con fondo: el sistema no acepta transparencia
    icon: [
      { url: "/icons/favicon-16.png", sizes: "16x16", type: "image/png" },
      { url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/favicon-48.png", sizes: "48x48", type: "image/png" },
    ],
    apple: [{ url: "/icons/icon-180.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#202124",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        {children}
        <Toaster richColors position="top-center" />
        <ErrorListener />
        <NativeBridge />
      </body>
    </html>
  );
}
