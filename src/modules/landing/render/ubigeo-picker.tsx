"use client";

import { ChevronDown, MapPin, Search } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { filterOptions, normalizeForSearch } from "@/modules/ubigeo/names";

type Compact = { d: [string, string][]; p: [string, string][]; t: [string, string][] };
type Index = {
  departments: { code: string; name: string }[];
  provinces: Map<string, { code: string; name: string }[]>;
  districts: Map<string, { code: string; name: string }[]>;
  names: Map<string, string>;
  search: { code: string; label: string; key: string }[];
};

let cache: Promise<Index> | null = null;

function loadUbigeo(): Promise<Index> {
  cache ??= fetch("/ubigeo-pe.json")
    .then((r) => r.json() as Promise<Compact>)
    .then((data) => {
      const names = new Map<string, string>();
      const provinces = new Map<string, { code: string; name: string }[]>();
      const districts = new Map<string, { code: string; name: string }[]>();
      for (const [code, name] of [...data.d, ...data.p, ...data.t]) names.set(code, name);
      for (const [code, name] of data.p) {
        const list = provinces.get(code.slice(0, 2)) ?? [];
        list.push({ code, name });
        provinces.set(code.slice(0, 2), list);
      }
      for (const [code, name] of data.t) {
        const list = districts.get(code.slice(0, 4)) ?? [];
        list.push({ code, name });
        districts.set(code.slice(0, 4), list);
      }
      const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, "es");
      provinces.forEach((l) => l.sort(byName));
      districts.forEach((l) => l.sort(byName));
      const search = data.t.map(([code, name]) => {
        const label = `${name} — ${names.get(code.slice(0, 4))}, ${names.get(code.slice(0, 2))}`;
        return { code, label, key: normalizeForSearch(label) };
      });
      return {
        departments: data.d.map(([code, name]) => ({ code, name })).sort(byName),
        provinces,
        districts,
        names,
        search,
      };
    })
    .catch((e) => {
      cache = null;
      throw e;
    });
  return cache;
}

export type UbigeoValue = { department: string; province: string; district: string };

/**
 * Lista que se puede filtrar escribiendo (las listas del celular no dejan escribir).
 * Al tocarla se abre con todas las opciones; mientras el cliente escribe, quedan solo las que coinciden.
 */
function FilterSelect({
  label,
  placeholder,
  options,
  value,
  disabled,
  onPick,
}: {
  label: string;
  placeholder: string;
  options: { code: string; name: string }[];
  value: string;
  disabled?: boolean;
  onPick: (code: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const listId = useId();
  const selected = options.find((o) => o.code === value);
  const shown = useMemo(() => filterOptions(options, text), [options, text]);

  const pick = (code: string) => {
    onPick(code);
    setOpen(false);
    setText("");
    input.current?.blur();
  };

  return (
    <div ref={wrap} className="relative scroll-mt-24">
      <input
        ref={input}
        type="text"
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="done"
        disabled={disabled}
        value={open ? text : (selected?.name ?? "")}
        placeholder={open && selected ? selected.name : placeholder}
        onFocus={() => {
          setOpen(true);
          setText("");
          setActive(0);
          // En el celular el teclado tapa media pantalla: sube el campo para que se vea la lista
          if (window.matchMedia("(pointer: coarse)").matches) setTimeout(() => wrap.current?.scrollIntoView({ block: "start", behavior: "smooth" }), 300);
        }}
        onBlur={() => {
          setOpen(false);
          setText("");
        }}
        onChange={(e) => {
          setText(e.target.value);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((i) => Math.min(i + 1, shown.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
          } else if (e.key === "Enter") {
            // Enter elige la opción marcada (y no envía el formulario)
            e.preventDefault();
            if (shown[active]) pick(shown[active].code);
          } else if (e.key === "Escape") {
            input.current?.blur();
          }
        }}
        className="h-12 w-full rounded-lg border border-zinc-300 bg-white pr-9 pl-3 text-base text-zinc-900 outline-none placeholder:text-zinc-500 focus:border-zinc-900 disabled:bg-zinc-100 disabled:text-zinc-400 disabled:placeholder:text-zinc-400"
      />
      <ChevronDown className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-zinc-400" />
      {open ? (
        <ul
          id={listId}
          role="listbox"
          aria-label={label}
          // Tocar la lista no le quita el foco al campo (así no se cierra antes de elegir)
          onMouseDown={(e) => e.preventDefault()}
          className="absolute z-30 mt-1 max-h-60 w-full overflow-auto overscroll-contain rounded-lg border border-zinc-200 bg-white py-1 shadow-lg"
        >
          {shown.length ? (
            shown.map((o, i) => (
              <li
                key={o.code}
                role="option"
                aria-selected={o.code === value}
                onClick={() => pick(o.code)}
                onMouseEnter={() => setActive(i)}
                className={`cursor-pointer px-3 py-2.5 text-sm text-zinc-800 ${i === active ? "bg-zinc-100" : ""} ${o.code === value ? "font-semibold" : ""}`}
              >
                {o.name}
              </li>
            ))
          ) : (
            <li className="px-3 py-2.5 text-sm text-zinc-500">Sin coincidencias</li>
          )}
        </ul>
      ) : null}
    </div>
  );
}

export function UbigeoPicker({ value, onChange, search = true }: { value: UbigeoValue; onChange: (value: UbigeoValue) => void; search?: boolean }) {
  const [index, setIndex] = useState<Index | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    loadUbigeo()
      .then(setIndex)
      .catch(() => setFailed(true));
  }, []);

  const results = useMemo(() => {
    if (!index || query.trim().length < 3) return [];
    const q = normalizeForSearch(query);
    return index.search.filter((s) => s.key.includes(q)).slice(0, 8);
  }, [index, query]);

  if (failed) return <p className="text-sm text-red-600">No pudimos cargar las ubicaciones. Recarga la página.</p>;

  const pick = (code: string) => {
    onChange({ department: code.slice(0, 2), province: code.slice(0, 4), district: code });
    setQuery("");
  };

  return (
    <div className="flex flex-col gap-2">
      {search ? (
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-zinc-400" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setTimeout(() => setFocused(false), 150)}
            placeholder="Busca tu distrito (ej: San Juan de Lurigancho)"
            className="h-12 w-full rounded-lg border border-zinc-300 bg-white pr-3 pl-9 text-base text-zinc-900 outline-none focus:border-zinc-900"
            autoComplete="off"
            disabled={!index}
          />
          {focused && results.length > 0 ? (
            <ul className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-zinc-200 bg-white py-1 shadow-lg">
              {results.map((r) => (
                <li key={r.code}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pick(r.code)}
                    className="flex w-full items-start gap-2 px-3 py-2.5 text-left text-sm text-zinc-800 hover:bg-zinc-100"
                  >
                    <MapPin className="mt-0.5 size-4 shrink-0 text-zinc-400" />
                    {r.label}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <FilterSelect
        label="Departamento"
        placeholder={index ? "Departamento" : "Cargando ubicaciones…"}
        options={index?.departments ?? []}
        value={value.department}
        disabled={!index}
        onPick={(code) => onChange({ department: code, province: "", district: "" })}
      />
      <FilterSelect
        label="Provincia"
        placeholder="Provincia"
        options={index?.provinces.get(value.department) ?? []}
        value={value.province}
        disabled={!value.department}
        onPick={(code) => onChange({ ...value, province: code, district: "" })}
      />
      <FilterSelect
        label="Distrito"
        placeholder="Distrito"
        options={index?.districts.get(value.province) ?? []}
        value={value.district}
        disabled={!value.province}
        onPick={(code) => onChange({ ...value, district: code })}
      />
    </div>
  );
}
