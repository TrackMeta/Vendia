"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { toast } from "sonner";
import { externalUrl, isNativeApp, nativePlugin, PUSH_PREFS_EVENT, vendiaNativo } from "@/modules/app-native/client";
import { fileNameFrom, saveFile } from "@/modules/app-native/files";
import { refreshDeviceIfStale, registerPush, scheduleDeviceSync } from "@/modules/app-native/push";
import { SOUND_PREFS_EVENT } from "@/modules/notifications/sound";

type Handle = { remove: () => Promise<void> | void };
type AppPlugin = {
  addListener: (event: string, cb: (data: never) => void) => Promise<Handle>;
  minimizeApp?: () => Promise<void>;
};

function openExternal(url: string) {
  void vendiaNativo()
    ?.abrirExterno({ url })
    .catch((e: unknown) => toast.error(e instanceof Error && e.message ? e.message : "No se pudo abrir"));
}

const externalTarget = (href: string) => externalUrl(href, window.location.href);

function hexOf(color: string): string | null {
  const m = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return null;
  return `#${[m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, "0")).join("")}`;
}

/** Barra del celular (hora, batería) del mismo color que la cabecera, con íconos legibles. */
function paintBars() {
  const el = document.querySelector("header") ?? document.body;
  const hex = hexOf(getComputedStyle(el).backgroundColor) ?? "#ffffff";
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const light = 0.299 * r + 0.587 * g + 0.114 * b > 150;
  void vendiaNativo()
    ?.barras({ color: hex, claro: light })
    .catch(() => {});
}

/**
 * Solo dentro de la app de celular (en el navegador no hace nada):
 * enlaces externos a su app, descargas a Descargas, botón «atrás», barra del celular y avisos.
 */
export function NativeBridge() {
  const pathname = usePathname();
  const router = useRouter();

  // Pantalla de inicio de la app: se cierra cuando ya hay contenido (no los cuadros grises de carga). Tope de 6 s.
  useEffect(() => {
    if (!isNativeApp()) return;
    const desde = Date.now();
    const timer = setInterval(() => {
      if (document.querySelector('[aria-busy="true"]') && Date.now() - desde < 6000) return;
      clearInterval(timer);
      requestAnimationFrame(() => void vendiaNativo()?.listo?.().catch(() => {}));
    }, 100);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!isNativeApp()) return;

    // Enlaces: WhatsApp, llamadas, mapas y otras páginas se abren en su app; los de Vendia «en pestaña nueva» (rótulos), aquí mismo
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.hasAttribute("download")) return;
      const external = externalTarget(a.href);
      if (external) {
        e.preventDefault();
        openExternal(external);
      } else if (a.target === "_blank") {
        e.preventDefault();
        window.location.href = a.href;
      }
    };

    // window.open (p. ej. «Escribir por WhatsApp» desde un botón)
    const originalOpen = window.open;
    window.open = ((url?: string | URL) => {
      const href = url ? String(url) : "";
      const external = href ? externalTarget(href) : null;
      if (external) openExternal(external);
      else if (href) window.location.href = href;
      return null;
    }) as typeof window.open;

    // Formularios que descargan un archivo (CSV): se baja aquí y se guarda en Descargas
    const onSubmit = (e: SubmitEvent) => {
      const form = e.target as HTMLFormElement | null;
      if (!form?.matches?.("form[data-download]")) return;
      e.preventDefault();
      void (async () => {
        try {
          const res = await fetch(form.action, { method: form.method || "POST", body: new FormData(form), credentials: "same-origin" });
          if (!res.ok) throw new Error();
          const blob = await res.blob();
          await saveFile(blob, fileNameFrom(res.headers.get("content-disposition"), form.dataset.download || "archivo"), blob.type);
        } catch {
          toast.error("No se pudo descargar el archivo");
        }
      })();
    };

    document.addEventListener("click", onClick, true);
    document.addEventListener("submit", onSubmit, true);

    // Botón «atrás» de Android: cierra la ventana abierta, si no vuelve atrás; en el inicio, minimiza
    const App = nativePlugin<AppPlugin>("App");
    const handles: Promise<Handle>[] = [];
    const listen = (event: string, cb: (data: never) => void) => {
      if (App) handles.push(App.addListener(event, cb));
    };
    listen("backButton", (({ canGoBack }: { canGoBack: boolean }) => {
      const dialog = document.querySelector('[role="dialog"][data-state="open"], [role="menu"][data-state="open"], [role="listbox"]');
      if (dialog) {
        document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        return;
      }
      if (canGoBack) window.history.back();
      else void App?.minimizeApp?.();
    }) as (d: never) => void);

    // Enlaces de Vendia abiertos desde otra app o los atajos del ícono → dentro de la app
    listen("appUrlOpen", (({ url }: { url: string }) => {
      try {
        const u = new URL(url);
        if (u.host === window.location.host) router.push(`${u.pathname}${u.search}${u.hash}`);
      } catch {}
    }) as (d: never) => void);

    // Volver a la app (desde otra app o la pantalla de inicio)
    listen("resume", (() => refreshDeviceIfStale()) as (d: never) => void);

    // Sonido o tiendas cambiados en Notificaciones → se actualiza este celular
    window.addEventListener(SOUND_PREFS_EVENT, scheduleDeviceSync);
    window.addEventListener(PUSH_PREFS_EVENT, scheduleDeviceSync);

    const scheme = window.matchMedia("(prefers-color-scheme: dark)");
    scheme.addEventListener("change", paintBars);

    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("submit", onSubmit, true);
      window.open = originalOpen;
      window.removeEventListener(SOUND_PREFS_EVENT, scheduleDeviceSync);
      window.removeEventListener(PUSH_PREFS_EVENT, scheduleDeviceSync);
      scheme.removeEventListener("change", paintBars);
      handles.forEach((h) => void h.then((x) => x.remove()).catch(() => {}));
    };
  }, [router]);

  useEffect(() => {
    if (!isNativeApp()) return;
    // Después de pintar la nueva página
    const t = setTimeout(paintBars, 50);
    if (pathname.startsWith("/dashboard")) {
      void registerPush();
      refreshDeviceIfStale();
    }
    return () => clearTimeout(t);
  }, [pathname]);

  return null;
}
