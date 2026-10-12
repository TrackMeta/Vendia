"use client";

import * as React from "react";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

/**
 * Selector con el diseño de la app (en vez del desplegable del navegador). Se usa igual que un
 * `<select>`: mismas `<option>` / `<optgroup>`, `value` o `defaultValue`, `name` para formularios y
 * `onChange={(e) => … e.target.value}`.
 */
type Option = { value: string; label: React.ReactNode; text: string; disabled: boolean };
type Group = { label: string | null; options: Option[] };

type AppSelectProps = {
  id?: string;
  name?: string;
  value?: string | number;
  defaultValue?: string | number;
  onChange?: (e: { target: { value: string; name: string } }) => void;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  "aria-label"?: string;
  title?: string;
  children?: React.ReactNode;
};

/** Valor interno para la opción vacía (`value=""`): el componente base reserva null para «sin elegir». */
const EMPTY = "__vd_empty__";
const toInner = (v: string) => (v === "" ? EMPTY : v);
const toOuter = (v: string) => (v === EMPTY ? "" : v);
/** La altura del <select> original (h-9, h-10…) también para el botón (clases fijas para Tailwind). */
const HEIGHT: Record<string, string> = { "9": "data-[size=default]:h-9", "10": "data-[size=default]:h-10", "11": "data-[size=default]:h-11" };

function textOf(node: React.ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (React.isValidElement<{ children?: React.ReactNode }>(node)) return textOf(node.props.children);
  return "";
}

function collect(children: React.ReactNode, groups: Group[], current: Group) {
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement<{ children?: React.ReactNode; value?: string | number; disabled?: boolean; label?: string }>(child)) return;
    if (child.type === React.Fragment) {
      collect(child.props.children, groups, current);
    } else if (child.type === "optgroup") {
      const group: Group = { label: child.props.label ?? null, options: [] };
      groups.push(group);
      collect(child.props.children, groups, group);
    } else if (child.type === "option") {
      const text = textOf(child.props.children);
      current.options.push({ value: String(child.props.value ?? text), label: child.props.children, text, disabled: Boolean(child.props.disabled) });
    }
  });
}

export function AppSelect({ id, name, value, defaultValue, onChange, disabled, required, className, title, children, ...rest }: AppSelectProps) {
  const groups = React.useMemo(() => {
    const root: Group = { label: null, options: [] };
    const list: Group[] = [root];
    collect(children, list, root);
    return list.filter((g) => g.options.length);
  }, [children]);
  const options = groups.flatMap((g) => g.options);
  const controlled = value !== undefined;
  const [inner, setInner] = React.useState(() => String(defaultValue ?? options[0]?.value ?? ""));
  const current = controlled ? String(value) : inner;
  const height = HEIGHT[className?.match(/(?:^|\s)h-(\d+)(?=\s|$)/)?.[1] ?? ""];

  return (
    <Select
      value={toInner(current)}
      onValueChange={(v) => {
        const next = toOuter(String(v ?? ""));
        if (!controlled) setInner(next);
        onChange?.({ target: { value: next, name: name ?? "" } });
      }}
      items={options.map((o) => ({ value: toInner(o.value), label: o.label }))}
      disabled={disabled}
      required={required}
    >
      <SelectTrigger
        id={id}
        title={title}
        aria-label={rest["aria-label"]}
        className={cn("min-w-0 justify-between bg-background text-left", className, height)}
      >
        <SelectValue className="truncate" />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false} align="start" className="max-h-72">
        {groups.map((g, gi) => (
          <SelectGroup key={gi}>
            {g.label ? <SelectLabel>{g.label}</SelectLabel> : null}
            {g.options.map((o) => (
              <SelectItem key={o.value} value={toInner(o.value)} disabled={o.disabled} label={o.text}>
                {o.label}
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
      {name ? <input type="hidden" name={name} value={current} /> : null}
    </Select>
  );
}
