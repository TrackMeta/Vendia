"use client";

import { useEffect } from "react";

/** Recuerda la variante A/B que vio el visitante (30 días), para mostrarle siempre la misma. */
export function AbRemember({ cookie, slug }: { cookie: string; slug: string }) {
  useEffect(() => {
    document.cookie = `${cookie}=${encodeURIComponent(slug)}; path=/; max-age=${60 * 60 * 24 * 30}; samesite=lax`;
  }, [cookie, slug]);
  return null;
}
