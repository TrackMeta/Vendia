"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { LABEL_COOKIE, serializeLabelOptions, type LabelOptions } from "./options";

function saveLabelOptions(o: LabelOptions) {
  document.cookie = `${LABEL_COOKIE}=${serializeLabelOptions(o)}; path=/; max-age=31536000; samesite=lax`;
}

/** Interruptores de los rótulos de provincia: logo de la tienda y saldo a cobrar. */
export function ProvinceLabelOptions({ options, hasLogo }: { options: LabelOptions; hasLogo: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const toggle = (key: keyof LabelOptions) => {
    const next = { ...options, [key]: !options[key] };
    saveLabelOptions(next);
    start(() => router.refresh());
  };
  const item = (key: keyof LabelOptions, label: string, disabled = false) => (
    <label className={`flex items-center gap-1.5 rounded-md border bg-white px-2.5 py-1 text-sm ${disabled ? "opacity-50" : "cursor-pointer"}`}>
      <input type="checkbox" checked={options[key] && !disabled} disabled={disabled || pending} onChange={() => toggle(key)} className="size-4 accent-zinc-900" />
      {label}
    </label>
  );
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-zinc-600">Provincia:</span>
      {item("logo", hasLogo ? "Logo de la tienda" : "Logo (súbelo en Configuración)", !hasLogo)}
      {item("saldo", "Saldo a cobrar")}
    </div>
  );
}
