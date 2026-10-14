import { BellRing, Download, FileSpreadsheet, MessageCircle, Smartphone, Store } from "lucide-react";
import type { Metadata } from "next";
import { PageHeader } from "@/components/dashboard/page-header";
import { requireStore } from "@/lib/auth";
import { APK_URL } from "@/modules/app-native/download";

export const metadata: Metadata = { title: "App de celular" };

const FEATURES = [
  { icon: BellRing, title: "Avisos con la app cerrada", text: "Cada pedido nuevo te suena con el sonido que elegiste, aunque no tengas Vendia abierta." },
  { icon: Store, title: "Todas tus tiendas", text: "Elige de qué tiendas te llegan avisos. Al tocar uno, Vendia cambia a esa tienda y abre el pedido." },
  { icon: MessageCircle, title: "WhatsApp y llamadas", text: "Los botones de WhatsApp, llamar y mapas abren directo su app." },
  { icon: FileSpreadsheet, title: "Excel y rótulos", text: "El Excel de Shalom/Eva y el CSV se guardan en Descargas y los puedes compartir; los rótulos se imprimen o guardan en PDF." },
];

const STEPS = [
  "Abre esta página en tu celular Android (en Chrome) y toca «Descargar la app».",
  "Cuando termine, toca el archivo Vendia.apk. Si el celular pregunta, permite «Instalar apps de este origen».",
  "Toca «Instalar» y abre Vendia. Entra con tu correo y contraseña de siempre.",
  "Acepta el permiso de notificaciones y, en Notificaciones → «Avisos en este celular», manda un aviso de prueba.",
];

export default async function AppPage() {
  await requireStore();
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <PageHeader title="App de celular" description="Vendia en tu celular Android, con avisos de pedidos aunque la app esté cerrada. Cada persona del equipo la instala con su propia cuenta." />

      <section className="flex flex-col items-start gap-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10 sm:flex-row sm:items-center">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Smartphone className="size-6" aria-hidden />
        </span>
        <div className="flex flex-1 flex-col gap-0.5">
          <h2 className="text-sm font-semibold">Vendia para Android</h2>
          <p className="text-xs text-muted-foreground">Gratis. Se actualiza sola con cada mejora de Vendia; solo los cambios grandes piden descargarla otra vez.</p>
        </div>
        <a href={APK_URL} className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90">
          <Download className="size-4" aria-hidden /> Descargar la app
        </a>
      </section>

      <section className="grid gap-3 sm:grid-cols-2">
        {FEATURES.map((f) => (
          <div key={f.title} className="flex gap-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
            <f.icon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
            <div className="flex flex-col gap-0.5">
              <h3 className="text-sm font-medium">{f.title}</h3>
              <p className="text-xs text-muted-foreground">{f.text}</p>
            </div>
          </div>
        ))}
      </section>

      <section className="flex flex-col gap-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
        <h2 className="text-sm font-semibold">Cómo instalarla</h2>
        <ol className="flex flex-col gap-2">
          {STEPS.map((s, i) => (
            <li key={s} className="flex gap-3 text-sm">
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">{i + 1}</span>
              <span>{s}</span>
            </li>
          ))}
        </ol>
        <p className="text-xs text-muted-foreground">Por ahora solo para Android. En iPhone puedes usar Vendia desde Safari → Compartir → «Agregar a inicio».</p>
      </section>
    </div>
  );
}
