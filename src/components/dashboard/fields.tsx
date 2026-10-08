"use client";

import { ArrowDown, ArrowUp, Plus, Trash2, X } from "lucide-react";
import { ImageDropzone } from "@/components/dashboard/image-dropzone";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { publicAssetUrl } from "@/lib/env";

export function TextField({
  label,
  value,
  onChange,
  placeholder,
  multiline,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs">{label}</Label>
      {multiline ? (
        <Textarea rows={3} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <Input value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      )}
    </div>
  );
}

export function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  suffix?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs">{label}</Label>
      <div className="flex items-center gap-2">
        <Input
          type="number"
          value={value}
          min={min}
          max={max}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n)) onChange(Math.min(max ?? n, Math.max(min ?? n, Math.round(n))));
          }}
        />
        {suffix ? <span className="text-xs text-muted-foreground">{suffix}</span> : null}
      </div>
    </div>
  );
}

export function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs">{label}</Label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 w-10 cursor-pointer rounded border bg-transparent p-0.5"
        />
        <Input
          value={value}
          onChange={(e) => {
            const v = e.target.value.trim();
            if (/^#[0-9a-fA-F]{0,6}$/.test(v)) onChange(v.length === 7 ? v.toLowerCase() : v);
          }}
          className="font-mono text-xs"
        />
      </div>
    </div>
  );
}

export function ToggleField({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label className="flex items-start justify-between gap-3 py-1">
      <span className="flex flex-col">
        <span className="text-sm">{label}</span>
        {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
      </span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}

export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs">{label}</Label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function ImageField({
  label,
  value,
  onChange,
  storeId,
  folder,
  maxSize,
}: {
  label: string;
  value: string;
  onChange: (path: string) => void;
  storeId: string;
  folder: string;
  maxSize?: number;
}) {
  const src = publicAssetUrl(value);
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs">{label}</Label>
      {src ? (
        <div className="relative overflow-hidden rounded-lg border bg-muted">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt="" className="max-h-56 w-full object-contain" />
          <button
            type="button"
            onClick={() => onChange("")}
            aria-label="Quitar imagen"
            className="absolute top-1 right-1 rounded bg-white/90 p-1 text-zinc-700 shadow hover:text-red-600"
          >
            <X className="size-4" />
          </button>
        </div>
      ) : null}
      <ImageDropzone
        compact
        multiple={false}
        storeId={storeId}
        folder={folder}
        maxSize={maxSize}
        label={src ? "Reemplazar imagen" : "Subir imagen"}
        onUploaded={(imgs) => onChange(imgs[0].path)}
      />
    </div>
  );
}

/** Editor genérico de listas (beneficios, FAQ, testimonios, imágenes del carrusel). */
export function ListEditor<T>({
  label,
  items,
  onChange,
  createItem,
  renderItem,
  max = 20,
  addLabel = "Agregar",
}: {
  label: string;
  items: T[];
  onChange: (items: T[]) => void;
  createItem: () => T;
  renderItem: (item: T, update: (patch: Partial<T>) => void, index: number) => React.ReactNode;
  max?: number;
  addLabel?: string;
}) {
  const move = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };
  return (
    <div className="flex flex-col gap-2">
      <Label className="text-xs">{label}</Label>
      {items.map((item, index) => (
        <div key={index} className="flex flex-col gap-2 rounded-lg border p-2.5">
          {renderItem(item, (patch) => onChange(items.map((it, i) => (i === index ? { ...it, ...patch } : it))), index)}
          <div className="flex justify-end gap-1">
            <Button type="button" size="icon-xs" variant="ghost" onClick={() => move(index, -1)} aria-label="Subir">
              <ArrowUp />
            </Button>
            <Button type="button" size="icon-xs" variant="ghost" onClick={() => move(index, 1)} aria-label="Bajar">
              <ArrowDown />
            </Button>
            <Button type="button" size="icon-xs" variant="ghost" onClick={() => onChange(items.filter((_, i) => i !== index))} aria-label="Eliminar">
              <Trash2 />
            </Button>
          </div>
        </div>
      ))}
      {items.length < max ? (
        <Button type="button" size="sm" variant="outline" onClick={() => onChange([...items, createItem()])}>
          <Plus /> {addLabel}
        </Button>
      ) : null}
    </div>
  );
}
