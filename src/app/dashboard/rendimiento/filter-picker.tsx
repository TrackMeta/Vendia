"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { AppSelect } from "@/components/dashboard/app-select";

/** Elige qué campaña, conjunto, anuncio, ángulo, producto o página ver en el Embudo o en Zonas. */
export function FilterPicker({ options, value, label }: { options: { value: string; label: string; href: string }[]; value: string; label: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <AppSelect
      aria-label={label}
      value={value}
      disabled={pending}
      className="h-9 w-full max-w-md"
      onChange={(e) => {
        const href = options.find((o) => o.value === e.target.value)?.href;
        if (href) start(() => router.push(href));
      }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </AppSelect>
  );
}
