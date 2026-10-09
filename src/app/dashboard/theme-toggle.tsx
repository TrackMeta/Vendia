"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";
import { THEME_COOKIE, type ThemePref } from "@/lib/theme";

const OPTIONS: { value: ThemePref; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Claro", icon: Sun },
  { value: "dark", label: "Oscuro", icon: Moon },
  { value: "system", label: "Como el dispositivo", icon: Monitor },
];

const DARK_QUERY = "(prefers-color-scheme: dark)";

/** true/false según el sistema; null en el servidor (no se sabe hasta cargar en el navegador). */
function useSystemDark(): boolean | null {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(DARK_QUERY);
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia(DARK_QUERY).matches,
    () => null,
  );
}

/** Tema efectivo del panel. «Como el dispositivo» se resuelve en el navegador. */
export function useEffectiveDark(pref: ThemePref): boolean {
  const systemDark = useSystemDark();
  const dark = pref === "dark" || (pref === "system" && systemDark === true);

  // También en <html>, para que los menús, diálogos y avisos (que se abren fuera del panel) sigan el tema.
  // Al salir del panel se quita: las landings públicas siempre van en claro.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", dark);
    root.style.colorScheme = dark ? "dark" : "light";
    return () => {
      root.classList.remove("dark");
      root.style.colorScheme = "";
    };
  }, [dark]);

  return dark;
}

export function saveThemePref(pref: ThemePref) {
  document.cookie = `${THEME_COOKIE}=${pref}; path=/; max-age=31536000; samesite=lax`;
}

/** Selector Claro / Oscuro / Como el dispositivo (en el pie del menú). */
export function ThemeToggle({ value, onChange }: { value: ThemePref; onChange: (pref: ThemePref) => void }) {
  return (
    <div className="flex items-center gap-0.5 rounded-md bg-white/[0.04] p-0.5" role="group" aria-label="Tema del panel">
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          title={o.label}
          aria-label={o.label}
          aria-pressed={value === o.value}
          onClick={() => {
            saveThemePref(o.value);
            onChange(o.value);
          }}
          className={cn(
            "flex flex-1 items-center justify-center rounded px-2 py-1 text-muted-foreground transition-colors hover:text-white",
            value === o.value && "bg-white/10 text-white",
          )}
        >
          <o.icon className="size-3.5" />
        </button>
      ))}
    </div>
  );
}
