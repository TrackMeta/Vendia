"use client";

import { Link2, Plus, RotateCcw, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ANGLE_PARAM, changedBlockIds } from "@/modules/landing/angles";
import { type LandingContent, MAX_ANGLES, PAGE_BLOCK_LABELS, type PageBlock } from "@/modules/landing/schema";
import { cn } from "@/lib/utils";

/**
 * «Versión que editas»: la principal o uno de sus ángulos. En un ángulo se cambian solo textos e
 * imágenes de los bloques; formulario, ofertas y estilo son comunes a todas las versiones.
 */
export function AngleBar({
  content,
  active,
  mainAngle,
  publicUrl,
  onSelect,
  onAdd,
  onRename,
  onDelete,
}: {
  content: LandingContent;
  active: string | null;
  /** Nombre del ángulo de la versión principal (pestaña Ventas). */
  mainAngle: string;
  publicUrl: string;
  onSelect: (key: string | null) => void;
  onAdd: (name: string) => void;
  onRename: (key: string, name: string) => void;
  onDelete: (key: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const angles = content.angles ?? [];
  const current = angles.find((a) => a.key === active) ?? null;
  const link = (key: string | null) => (key ? `${publicUrl}?${ANGLE_PARAM}=${key}` : publicUrl);

  const copy = (key: string | null) => {
    void navigator.clipboard.writeText(link(key));
    toast.success("Link copiado: úsalo en el anuncio de este ángulo");
  };

  const add = () => {
    if (!name.trim()) return;
    onAdd(name.trim());
    setName("");
    setAdding(false);
  };

  return (
    <div className="flex flex-col gap-2 border-b bg-muted/30 px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Versión que editas</p>
        {angles.length < MAX_ANGLES ? (
          <Button size="xs" variant="ghost" onClick={() => setAdding((v) => !v)}>
            <Plus /> Nuevo ángulo
          </Button>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => onSelect(null)}
          className={cn("rounded-full border px-2.5 py-1 text-xs", active === null ? "border-foreground bg-foreground text-background" : "bg-background hover:bg-muted")}
        >
          Principal{mainAngle ? ` · ${mainAngle}` : ""}
        </button>
        {angles.map((a) => {
          const changes = changedBlockIds(content, a.key).size;
          return (
            <button
              key={a.key}
              type="button"
              onClick={() => onSelect(a.key)}
              className={cn("rounded-full border px-2.5 py-1 text-xs", active === a.key ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-muted")}
            >
              {a.name}
              {changes ? <span className="opacity-70"> · {changes}</span> : null}
            </button>
          );
        })}
      </div>

      {adding ? (
        <div className="flex gap-2">
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, 60))}
            onKeyDown={(e) => e.key === "Enter" && add()}
            placeholder="Ej: Acné, Manchas, Regalo para mamá"
            className="h-8"
          />
          <Button size="sm" onClick={add} disabled={!name.trim()}>
            Crear
          </Button>
        </div>
      ) : null}

      {current ? (
        <div className="flex flex-col gap-2 rounded-lg border bg-background p-2.5">
          <div className="flex gap-2">
            <Input value={current.name} onChange={(e) => onRename(current.key, e.target.value.slice(0, 60))} className="h-8" aria-label="Nombre del ángulo" />
            <Button size="icon-sm" variant="ghost" aria-label="Eliminar ángulo" onClick={() => confirm(`¿Eliminar el ángulo «${current.name}»?`) && onDelete(current.key)}>
              <Trash2 />
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 text-[11px]">?{ANGLE_PARAM}={current.key}</code>
            <Button size="xs" variant="outline" onClick={() => copy(current.key)}>
              <Link2 /> Copiar link
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Toca un bloque en la vista previa y cambia su texto o imagen: solo cambia en este ángulo. Ofertas, formulario y estilo son los mismos para todas las versiones.
          </p>
        </div>
      ) : angles.length ? (
        <button type="button" onClick={() => copy(null)} className="w-fit text-xs text-muted-foreground hover:text-foreground">
          <Link2 className="mr-1 inline size-3" /> Copiar link de la versión principal
        </button>
      ) : (
        <p className="text-xs text-muted-foreground">Crea un ángulo para mostrar otros textos e imágenes según el anuncio, con la misma landing.</p>
      )}
    </div>
  );
}

/** En un ángulo: la lista de bloques con cuáles cambian y la opción de volver al principal. */
export function AngleBlockList({
  blocks,
  changed,
  selectedId,
  onSelect,
  onReset,
}: {
  blocks: PageBlock[];
  changed: Set<string>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onReset: (id: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      {blocks.map((b) => (
        <div
          key={b.id}
          className={cn("flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-sm", selectedId === b.id && "border-primary/60 bg-primary/5")}
        >
          <button type="button" onClick={() => onSelect(b.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
            <span className={cn("size-2 shrink-0 rounded-full", changed.has(b.id) ? "bg-primary" : "bg-muted-foreground/25")} aria-hidden />
            <span className="truncate">{PAGE_BLOCK_LABELS[b.type]}</span>
            {changed.has(b.id) ? <span className="text-xs text-primary">cambiado</span> : null}
          </button>
          {changed.has(b.id) ? (
            <Button size="icon-xs" variant="ghost" aria-label="Volver a la versión principal" title="Volver a la versión principal" onClick={() => onReset(b.id)}>
              <RotateCcw />
            </Button>
          ) : null}
        </div>
      ))}
    </div>
  );
}
