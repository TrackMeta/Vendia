"use client";

import { Play, Volume2, VolumeX } from "lucide-react";
import { useMemo, useSyncExternalStore } from "react";
import { AppSelect } from "@/components/dashboard/app-select";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  DEFAULT_SOUND_PREFS,
  parseSoundPrefs,
  playSound,
  saveSoundPrefs,
  SOUND_PREFS_KEY,
  SOUND_PREFS_EVENT,
  SOUNDS,
  type SoundKind,
  type SoundPrefs,
  type SoundVolume,
  VOLUMES,
} from "@/modules/notifications/sound";

/** Preferencias de sonido de esta persona (en este navegador), al día si cambian en otra parte de la página. */
export function useSoundPrefs(): [SoundPrefs, (p: SoundPrefs) => void, boolean] {
  const raw = useSyncExternalStore(subscribe, readRaw, () => SERVER_SNAPSHOT);
  const prefs = useMemo(() => (raw === SERVER_SNAPSHOT ? DEFAULT_SOUND_PREFS : parseSoundPrefs(raw)), [raw]);
  return [prefs, saveSoundPrefs, raw !== SERVER_SNAPSHOT];
}

/** En el servidor no hay navegador: se muestra lo predeterminado hasta cargar. */
const SERVER_SNAPSHOT = "__servidor__";

function readRaw(): string {
  try {
    return localStorage.getItem(SOUND_PREFS_KEY) ?? "";
  } catch {
    return "";
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener(SOUND_PREFS_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(SOUND_PREFS_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** Ajustes del sonido de los avisos (página Notificaciones). */
export function SoundSettings() {
  const [prefs, update, ready] = useSoundPrefs();
  const set = (patch: Partial<SoundPrefs>) => update({ ...prefs, ...patch });

  return (
    <section className="flex flex-col gap-4 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            {prefs.enabled ? <Volume2 className="size-4" aria-hidden /> : <VolumeX className="size-4 text-muted-foreground" aria-hidden />}
            Sonido de los avisos
          </h2>
          <p className="text-xs text-muted-foreground">Suena cuando llega un aviso con Vendia abierta. Se guarda en este celular o computadora: cada persona elige el suyo.</p>
        </div>
        <Switch checked={prefs.enabled} onCheckedChange={(enabled) => set({ enabled })} aria-label="Sonido de los avisos" disabled={!ready} />
      </div>

      <div className={cn("flex flex-col gap-4", !prefs.enabled && "pointer-events-none opacity-50")} aria-disabled={!prefs.enabled}>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex min-w-48 flex-1 flex-col gap-1.5 text-xs font-medium">
            Sonido
            <AppSelect value={prefs.sound} onChange={(e) => set({ sound: e.target.value as SoundKind })} className="h-9 w-full" aria-label="Sonido">
              {(Object.keys(SOUNDS) as SoundKind[]).map((k) => (
                <option key={k} value={k}>
                  {SOUNDS[k]}
                </option>
              ))}
            </AppSelect>
          </label>
          <Button type="button" variant="outline" className="h-9" onClick={() => playSound(prefs.sound, prefs.volume)}>
            <Play /> Probar sonido
          </Button>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium">Volumen</span>
          <div role="group" aria-label="Volumen" className="inline-flex w-fit rounded-lg bg-muted p-0.5">
            {(Object.keys(VOLUMES) as SoundVolume[]).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={prefs.volume === v}
                onClick={() => {
                  set({ volume: v });
                  playSound(prefs.sound, v);
                }}
                className={cn(
                  "h-8 rounded-md px-3 text-sm transition-colors",
                  prefs.volume === v ? "bg-background font-medium text-foreground shadow-sm ring-1 ring-foreground/10" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {VOLUMES[v]}
              </button>
            ))}
          </div>
        </div>

        <label className="flex items-start justify-between gap-3">
          <span className="flex flex-col">
            <span className="text-sm">Sonar solo con pedidos nuevos</span>
            <span className="text-xs text-muted-foreground">Los demás avisos (cliente riesgoso, «llamar después»…) aparecen en pantalla sin sonido.</span>
          </span>
          <Switch checked={prefs.onlyOrders} onCheckedChange={(onlyOrders) => set({ onlyOrders })} />
        </label>
      </div>
    </section>
  );
}
