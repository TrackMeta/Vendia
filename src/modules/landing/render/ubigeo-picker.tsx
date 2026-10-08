"use client";

import { MapPin, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { normalizeForSearch } from "@/modules/ubigeo/names";

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

const selectClass =
  "h-12 w-full appearance-none rounded-lg border border-zinc-300 bg-white px-3 text-base text-zinc-900 outline-none focus:border-zinc-900 disabled:bg-zinc-100 disabled:text-zinc-400";

export function UbigeoPicker({ value, onChange }: { value: UbigeoValue; onChange: (value: UbigeoValue) => void }) {
  const [index, setIndex] = useState<Index | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    loadUbigeo().then(setIndex).catch(() => setFailed(true));
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

      <select
        aria-label="Departamento"
        className={selectClass}
        value={value.department}
        disabled={!index}
        onChange={(e) => onChange({ department: e.target.value, province: "", district: "" })}
      >
        <option value="">{index ? "Departamento" : "Cargando ubicaciones…"}</option>
        {index?.departments.map((d) => (
          <option key={d.code} value={d.code}>
            {d.name}
          </option>
        ))}
      </select>
      <select
        aria-label="Provincia"
        className={selectClass}
        value={value.province}
        disabled={!value.department}
        onChange={(e) => onChange({ ...value, province: e.target.value, district: "" })}
      >
        <option value="">Provincia</option>
        {index?.provinces.get(value.department)?.map((p) => (
          <option key={p.code} value={p.code}>
            {p.name}
          </option>
        ))}
      </select>
      <select
        aria-label="Distrito"
        className={selectClass}
        value={value.district}
        disabled={!value.province}
        onChange={(e) => onChange({ ...value, district: e.target.value })}
      >
        <option value="">Distrito</option>
        {index?.districts.get(value.province)?.map((d) => (
          <option key={d.code} value={d.code}>
            {d.name}
          </option>
        ))}
      </select>
    </div>
  );
}
