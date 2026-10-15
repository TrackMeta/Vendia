"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import { cn } from "@/lib/utils";
import { THEME_COOKIE, type ThemePref } from "@/lib/theme";

const OPTIONS: { value: "light" | "dark"; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Claro", icon: Sun },
  { value: "dark", label: "Oscuro", icon: Moon },
];

const DARK_QUERY = "(prefers-color-scheme: dark)";

/** Avisa que cambió el tema (la app de celular vuelve a pintar la barra de arriba). */
export const THEME_EVENT = "vendia:theme";

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

/** Tema efectivo del panel. «Como el dispositivo» (preferencias antiguas) se resuelve en el navegador. */
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

type ViewTransitionDoc = Document & { startViewTransition?: (cb: () => void) => { ready: Promise<void>; finished: Promise<void> } };

/**
 * Celular: una sola capa del color del tema nuevo aparece, se cambia el tema debajo y la capa se va.
 * Es lo más liviano posible (solo se anima la transparencia de una capa): no se traba.
 */
function veilSwitch(apply: () => void, toDark: boolean, done: () => void) {
  const veil = document.createElement("div");
  veil.setAttribute("aria-hidden", "true");
  veil.style.cssText = `position:fixed;inset:0;z-index:2147483647;pointer-events:none;opacity:0;will-change:opacity;transition:opacity 110ms ease-out;background:${toDark ? "#17181b" : "#f3f4f6"}`;
  document.body.appendChild(veil);
  void veil.offsetWidth; // que el navegador vea la opacidad 0 antes de subirla
  veil.style.opacity = "1";
  // Con temporizadores (no con el fin de la animación): el tema se aplica siempre, aunque la animación no corra
  window.setTimeout(() => {
    apply();
    window.setTimeout(() => {
      veil.style.transition = "opacity 190ms ease-in";
      veil.style.opacity = "0";
      window.setTimeout(() => {
        veil.remove();
        done();
      }, 210);
    }, 30);
  }, 110);
}

/**
 * Cambia de tema. Computadora: un círculo que crece desde el botón tocado (View Transitions).
 * Celular (pantalla táctil): la capa liviana de arriba. Con «reducir movimiento», de golpe.
 */
function switchTheme(apply: () => void, from: HTMLElement, toDark: boolean) {
  const root = document.documentElement;
  const doc = document as ViewTransitionDoc;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const done = () => window.setTimeout(() => window.dispatchEvent(new Event(THEME_EVENT)), 60);
  if (reduce) {
    apply();
    done();
    return;
  }
  if (window.matchMedia("(pointer: coarse)").matches) {
    veilSwitch(apply, toDark, done);
    return;
  }
  if (!doc.startViewTransition) {
    root.classList.add("vd-theme-fade");
    apply();
    window.setTimeout(() => root.classList.remove("vd-theme-fade"), 250);
    done();
    return;
  }
  const b = from.getBoundingClientRect();
  const x = b.left + b.width / 2;
  const y = b.top + b.height / 2;
  const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
  root.classList.add("vd-theme-switch");
  const t = doc.startViewTransition(() => flushSync(apply));
  t.ready
    .then(() =>
      root.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        { duration: 300, easing: "cubic-bezier(0.2, 0, 0, 1)", pseudoElement: "::view-transition-new(root)" },
      ),
    )
    .catch(() => {});
  t.finished.finally(() => {
    root.classList.remove("vd-theme-switch");
    done();
  });
}

/**
 * Selector Claro / Oscuro: una píldora que se desliza hasta la opción elegida y el ícono hace un gesto
 * (el sol gira, la luna se inclina). `light` = versión para fondo claro (el «Más» del celular).
 */
export function ThemeToggle({ value, onChange, light = false }: { value: ThemePref; onChange: (pref: ThemePref) => void; light?: boolean }) {
  // Solo lee el tema (sin tocar <html>: eso lo hace el panel con useEffectiveDark)
  const systemDark = useSystemDark();
  const current = value === "dark" || (value === "system" && systemDark === true) ? "dark" : "light";
  const index = OPTIONS.findIndex((o) => o.value === current);
  return (
    <div
      role="radiogroup"
      aria-label="Tema del panel"
      className={cn("relative grid grid-cols-2 rounded-xl p-1", light ? "bg-muted" : "bg-white/[0.06]")}
    >
      <span
        aria-hidden
        className={cn(
          "absolute top-1 bottom-1 left-1 w-[calc(50%-0.25rem)] rounded-lg shadow-sm transition-transform duration-200 ease-[cubic-bezier(0.3,1.4,0.5,1)]",
          light ? "bg-background ring-1 ring-foreground/10" : "bg-white/15",
        )}
        style={{ transform: `translateX(${index * 100}%)` }}
      />
      {OPTIONS.map((o) => {
        const on = o.value === current;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={(e) => {
              if (on && value === o.value) return;
              const target = e.currentTarget;
              switchTheme(() => {
                saveThemePref(o.value);
                // Ya en el mismo instante (la foto «nueva» de la transición debe salir con el tema nuevo)
                document.documentElement.classList.toggle("dark", o.value === "dark");
                document.documentElement.style.colorScheme = o.value;
                onChange(o.value);
              }, target, o.value === "dark");
            }}
            className={cn(
              "relative z-10 flex h-8 items-center justify-center gap-1.5 rounded-lg text-xs transition-colors",
              on ? (light ? "font-medium text-foreground" : "font-medium text-white") : light ? "text-muted-foreground hover:text-foreground" : "text-white/55 hover:text-white",
            )}
          >
            <o.icon
              aria-hidden
              className={cn(
                "size-4 transition-transform duration-300 ease-[cubic-bezier(0.3,1.4,0.5,1)]",
                on && o.value === "light" && "rotate-90 scale-110 text-amber-500",
                on && o.value === "dark" && "-rotate-[20deg] scale-110 text-indigo-400",
              )}
            />
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
