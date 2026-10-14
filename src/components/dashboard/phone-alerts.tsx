"use client";

import { BellRing, Loader2, Send, Smartphone } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { getPushState, isNativeApp, parseMutedStores, PUSH_MUTED_KEY, PUSH_PREFS_EVENT, saveMutedStores, subscribePushState } from "@/modules/app-native/client";
import { registerPush } from "@/modules/app-native/push";

const BROWSER_STATE = getPushState();

function subscribeMuted(cb: () => void) {
  window.addEventListener(PUSH_PREFS_EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(PUSH_PREFS_EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

function readMutedRaw(): string {
  try {
    return localStorage.getItem(PUSH_MUTED_KEY) ?? "[]";
  } catch {
    return "[]";
  }
}

const STATUS_TEXT: Record<string, string> = {
  starting: "Activando los avisos…",
  "no-firebase": "Los avisos con la app cerrada todavía no están activos en esta versión de la app. Mientras tanto suenan con la app abierta.",
  denied: "Sin permiso de notificaciones: no te sonará el celular. Actívalo en Ajustes → Apps → Vendia → Notificaciones y vuelve a abrir la app.",
  error: "No se pudo activar los avisos en este celular. Cierra y vuelve a abrir la app.",
};

/** Notificaciones → «Avisos en este celular». Solo se ve dentro de la app de celular. */
export function PhoneAlerts({ stores }: { stores: { id: string; name: string }[] }) {
  const native = useSyncExternalStore(
    () => () => {},
    isNativeApp,
    () => false,
  );
  const push = useSyncExternalStore(subscribePushState, getPushState, () => BROWSER_STATE);
  const mutedRaw = useSyncExternalStore(subscribeMuted, readMutedRaw, () => "[]");
  const [testing, setTesting] = useState(false);
  if (!native) return null;

  const muted = new Set(parseMutedStores(mutedRaw));
  const ready = push.status === "ready";

  async function test() {
    setTesting(true);
    try {
      const res = await fetch("/api/push/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: push.token }) });
      const out = (await res.json().catch(() => ({}))) as { ok?: boolean; skipped?: string };
      if (out.ok) toast.success("Listo: en unos segundos te llega el aviso de prueba. Prueba también con la app cerrada.");
      else if (out.skipped === "sin_firebase") toast.error("Falta conectar Firebase en el servidor de Vendia.");
      else if (out.skipped === "sin_celulares") toast.error("Este celular todavía no está registrado. Cierra y vuelve a abrir la app.");
      else toast.error("No se pudo mandar el aviso de prueba.");
    } catch {
      toast.error("No se pudo mandar el aviso de prueba.");
    } finally {
      setTesting(false);
    }
  }

  return (
    <section className="flex flex-col gap-4 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <div className="flex items-start gap-2">
        <Smartphone className="mt-0.5 size-4 shrink-0" aria-hidden />
        <div className="flex flex-col gap-0.5">
          <h2 className="text-sm font-semibold">Avisos en este celular</h2>
          <p className="text-xs text-muted-foreground">
            {ready ? "Te llegan los avisos aunque la app esté cerrada, con el sonido que elegiste arriba." : (STATUS_TEXT[push.status] ?? STATUS_TEXT.starting)}
          </p>
        </div>
      </div>

      {ready ? (
        <>
          <Button type="button" variant="outline" className="w-fit" onClick={test} disabled={testing}>
            {testing ? <Loader2 className="animate-spin" /> : <Send />} Mandarme un aviso de prueba
          </Button>
          {stores.length > 1 ? (
            <div className="flex flex-col gap-2 border-t pt-3">
              <span className="flex items-center gap-1.5 text-xs font-medium">
                <BellRing className="size-3.5" aria-hidden /> Recibir avisos de
              </span>
              {stores.map((s) => (
                <label key={s.id} className="flex items-center justify-between gap-3 text-sm">
                  <span className="truncate">{s.name}</span>
                  <Switch
                    checked={!muted.has(s.id)}
                    onCheckedChange={(on) => saveMutedStores(on ? [...muted].filter((id) => id !== s.id) : [...muted, s.id])}
                    aria-label={`Avisos de ${s.name}`}
                  />
                </label>
              ))}
              <p className="text-xs text-muted-foreground">Solo en este celular. Al tocar un aviso de otra tienda, Vendia cambia a esa tienda sola.</p>
            </div>
          ) : null}
        </>
      ) : push.status === "error" || push.status === "denied" ? (
        <Button type="button" variant="outline" className="w-fit" onClick={() => void registerPush(true)}>
          Intentar de nuevo
        </Button>
      ) : null}
    </section>
  );
}
