"use client";

import { Check, MapPin } from "lucide-react";
import { useId, useState } from "react";
import { cn } from "@/lib/utils";
import { searchAgencies, SHALOM_DESTINATIONS, SHALOM_ORIGINS, suggestAgency } from "@/modules/couriers";

/**
 * Buscador de agencias Shalom (lista oficial). Solo acepta agencias de la lista:
 * una ciudad escrita a mano hace que Shalom rechace la fila de la carga masiva.
 */
export function AgencyPicker({
  value,
  onChange,
  hint,
  kind = "destination",
  className,
  id,
}: {
  value: string;
  onChange: (agency: string) => void;
  /** Texto para sugerir (provincia/distrito del cliente). */
  hint?: string;
  kind?: "destination" | "origin";
  className?: string;
  id?: string;
}) {
  const list = kind === "origin" ? SHALOM_ORIGINS : SHALOM_DESTINATIONS;
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const listId = useId();
  const [prevValue, setPrevValue] = useState(value);
  if (prevValue !== value) {
    setPrevValue(value);
    setQuery(value);
  }
  const results = open ? searchAgencies(query, 10, list) : [];
  const suggestion = !value && hint ? suggestAgency(hint, list) : "";
  const valid = !value || list.includes(value);

  const pick = (agency: string) => {
    onChange(agency);
    setQuery(agency);
    setOpen(false);
  };

  return (
    <div className={cn("relative flex flex-col gap-1", className)}>
      <div className="relative">
        <MapPin className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          id={id}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value.toUpperCase());
            setOpen(true);
            if (!e.target.value) onChange("");
          }}
          onFocus={() => setOpen(true)}
          onBlur={() =>
            setTimeout(() => {
              setOpen(false);
              // Escrita exacta → se acepta; si no, vuelve a la agencia elegida
              if (list.includes(query.trim())) {
                if (query.trim() !== value) onChange(query.trim());
              } else setQuery(value);
            }, 150)
          }
          placeholder={kind === "origin" ? "Agencia desde donde despachas" : "Busca la agencia (ej: Abancay)"}
          className={cn(
            "h-9 w-full rounded-lg border bg-transparent pr-2.5 pl-8 text-sm uppercase placeholder:normal-case",
            !valid && "border-destructive",
          )}
          autoComplete="off"
          role="combobox"
          aria-expanded={results.length > 0}
          aria-controls={listId}
        />
        {results.length ? (
          <ul id={listId} className="absolute z-30 mt-1 max-h-60 w-full overflow-auto rounded-lg border bg-popover p-1 shadow-md" role="listbox">
            {results.map((a) => (
              <li key={a}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(a)}
                  className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
                >
                  {a}
                  {a === value ? <Check className="size-4" /> : null}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {suggestion ? (
        <button type="button" onClick={() => pick(suggestion)} className="w-fit text-left text-xs text-primary hover:underline">
          Sugerida por la ubicación: {suggestion}
        </button>
      ) : null}
      {!valid ? <p className="text-xs text-destructive">No está en la lista oficial de Shalom: elige una de la lista.</p> : null}
      {open && query && !results.length ? <p className="text-xs text-muted-foreground">Sin coincidencias.</p> : null}
    </div>
  );
}
