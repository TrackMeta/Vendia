/** Preferencia de tema del panel (cookie por dispositivo). Las landings públicas siempre van en claro. */
export type ThemePref = "light" | "dark" | "system";

export const THEME_COOKIE = "vd_theme";

export function parseTheme(value: string | undefined): ThemePref {
  return value === "dark" || value === "system" ? value : "light";
}
