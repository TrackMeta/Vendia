"use client";

import { closestCenter, DndContext, type DragEndEvent, PointerSensor, TouchSensor, useSensor, useSensors } from "@dnd-kit/core";
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowLeft,
  Copy,
  ExternalLink,
  Eye,
  GripVertical,
  Link2,
  Lock,
  MoreHorizontal,
  Plus,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { SimpleBadge } from "@/components/dashboard/status-badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { publicAssetUrl } from "@/lib/env";
import { slugify } from "@/lib/format";
import { cn } from "@/lib/utils";
import { createFormBlock, createPageBlock, newBlockId } from "@/modules/landing/defaults";
import { LandingRenderer } from "@/modules/landing/render/landing-renderer";
import {
  FONTS,
  FORM_BLOCK_LABELS,
  type FormBlock,
  type FormBlockType,
  type LandingContent,
  LOCKED_FORM_BLOCKS,
  PAGE_BLOCK_LABELS,
  type PageBlock,
  type PageBlockType,
} from "@/modules/landing/schema";
import type { LandingRenderData, PublicOffer } from "@/modules/landing/types";
import { deleteLanding, duplicateLanding, publishLanding, saveLanding, unpublishLanding } from "../actions";
import { FormBlockInspector, PageBlockInspector } from "./block-inspector";
import { ColorField, SelectField, TextField, ToggleField } from "./fields";

type AnyBlock = PageBlock | FormBlock;

function blockSummary(block: AnyBlock): string {
  switch (block.type) {
    case "image":
      return block.src ? "Imagen subida" : "Sin imagen";
    case "button":
    case "form_submit":
    case "marquee":
    case "heading":
      return block.text;
    case "text":
    case "form_text":
      return block.text.slice(0, 40);
    case "carousel":
      return `${block.images.length} imágenes`;
    case "testimonials":
    case "faq":
    case "benefits":
      return `${block.items.length} elementos`;
    case "countdown":
      return `${block.minutes} min`;
    default:
      return "";
  }
}

function blockThumb(block: AnyBlock): string | null {
  if (block.type === "image" || block.type === "image_text" || block.type === "form_image") return publicAssetUrl(block.src);
  if (block.type === "carousel") return publicAssetUrl(block.images[0]?.src);
  return null;
}

function SortableRow({
  block,
  label,
  selected,
  locked,
  onSelect,
  onDuplicate,
  onDelete,
}: {
  block: AnyBlock;
  label: string;
  selected: boolean;
  locked: boolean;
  onSelect: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: block.id });
  const thumb = blockThumb(block);
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "group flex items-center gap-2 rounded-lg border bg-background px-2 py-1.5",
        selected && "border-primary ring-2 ring-primary/20",
        isDragging && "z-10 shadow-lg",
      )}
    >
      <button type="button" {...attributes} {...listeners} aria-label="Arrastrar" className="cursor-grab touch-none p-1 text-muted-foreground">
        <GripVertical className="size-4" />
      </button>
      <button type="button" onClick={onSelect} className="flex min-w-0 flex-1 items-center gap-2 text-left">
        {thumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumb} alt="" className="size-8 shrink-0 rounded object-cover" />
        ) : null}
        <span className="flex min-w-0 flex-col">
          <span className="text-sm font-medium">{label}</span>
          <span className="truncate text-xs text-muted-foreground">{blockSummary(block)}</span>
        </span>
      </button>
      {locked ? (
        <Lock className="mr-1 size-3.5 text-muted-foreground" aria-label="Bloque obligatorio" />
      ) : (
        <div className="flex opacity-60 group-hover:opacity-100">
          <Button type="button" size="icon-xs" variant="ghost" onClick={onDuplicate} aria-label="Duplicar">
            <Copy />
          </Button>
          <Button type="button" size="icon-xs" variant="ghost" onClick={onDelete} aria-label="Eliminar">
            <Trash2 />
          </Button>
        </div>
      )}
    </div>
  );
}

function BlockList<T extends AnyBlock>({
  blocks,
  labels,
  selectedId,
  locked = [],
  onSelect,
  onChange,
}: {
  blocks: T[];
  labels: Record<string, string>;
  selectedId: string | null;
  locked?: string[];
  onSelect: (id: string) => void;
  onChange: (blocks: T[]) => void;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } }));
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    onChange(arrayMove(blocks, blocks.findIndex((b) => b.id === e.active.id), blocks.findIndex((b) => b.id === e.over!.id)));
  };
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={blocks.map((b) => b.id)} strategy={verticalListSortingStrategy}>
        <div className="flex flex-col gap-1.5">
          {blocks.map((block, index) => (
            <SortableRow
              key={block.id}
              block={block}
              label={labels[block.type]}
              selected={selectedId === block.id}
              locked={locked.includes(block.type)}
              onSelect={() => onSelect(block.id)}
              onDuplicate={() => {
                const copy = { ...structuredClone(block), id: newBlockId() };
                const next = [...blocks];
                next.splice(index + 1, 0, copy);
                onChange(next);
                onSelect(copy.id);
              }}
              onDelete={() => onChange(blocks.filter((b) => b.id !== block.id))}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

const ADDABLE_PAGE_BLOCKS: PageBlockType[] = [
  "image",
  "button",
  "carousel",
  "marquee",
  "heading",
  "text",
  "benefits",
  "image_text",
  "price",
  "countdown",
  "testimonials",
  "faq",
  "divider",
  "embedded_form",
];
const ADDABLE_FORM_BLOCKS: FormBlockType[] = ["form_image", "form_text", "form_summary"];

export function LandingBuilder({
  landing,
  storeId,
  storeSlug,
  storeName,
  products,
  offersByProduct,
  pricing,
}: {
  landing: { id: string; title: string; slug: string; product_id: string; status: "draft" | "published"; content: LandingContent; hasUnpublishedChanges: boolean };
  storeId: string;
  storeSlug: string;
  storeName: string;
  products: { id: string; name: string; price: number; compare_at_price: number | null }[];
  offersByProduct: Record<string, PublicOffer[]>;
  pricing: { shippingLima: number; shippingProvince: number; advance: number };
}) {
  const router = useRouter();
  const [content, setContent] = useState<LandingContent>(landing.content);
  const [title, setTitle] = useState(landing.title);
  const [slug, setSlug] = useState(landing.slug);
  const [productId, setProductId] = useState(landing.product_id);
  const [status, setStatus] = useState(landing.status);
  const [dirty, setDirty] = useState(false);
  const [pendingChanges, setPendingChanges] = useState(landing.hasUnpublishedChanges);
  const [tab, setTab] = useState<"page" | "form" | "style">("page");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adding, setAdding] = useState<null | "page" | "form">(null);
  const [saving, startSaving] = useTransition();
  const [publishing, startPublishing] = useTransition();

  const update = useCallback((updater: (c: LandingContent) => LandingContent) => {
    setContent((c) => updater(c));
    setDirty(true);
    setPendingChanges(true);
  }, []);

  const selectedPage = content.page_blocks.find((b) => b.id === selectedId) ?? null;
  const selectedForm = content.form_blocks.find((b) => b.id === selectedId) ?? null;
  const product = products.find((p) => p.id === productId) ?? products[0];
  const publicPath = `/p/${storeSlug}/${slug}`;
  const ctx = { storeId, folder: `landings/${landing.id}` };

  const renderData: LandingRenderData = useMemo(
    () => ({
      landingId: null,
      storeName,
      storeSlug,
      landingSlug: slug,
      content,
      product: { name: product?.name ?? "", price: product?.price ?? 0, compare_at_price: product?.compare_at_price ?? null },
      offers: offersByProduct[productId] ?? [],
      shipping: { lima: pricing.shippingLima, province: pricing.shippingProvince },
      advanceAmount: pricing.advance,
    }),
    [content, product, productId, offersByProduct, pricing, slug, storeName, storeSlug],
  );

  const save = useCallback(
    (then?: () => void) =>
      startSaving(async () => {
        const result = await saveLanding(landing.id, { title, slug, product_id: productId, content });
        if (!result.ok) {
          toast.error(result.error);
          return;
        }
        setDirty(false);
        if (then) then();
        else toast.success(result.message ?? "Guardado");
      }),
    [content, landing.id, productId, slug, title],
  );

  const publish = () =>
    save(() =>
      startPublishing(async () => {
        const result = await publishLanding(landing.id);
        if (!result.ok) {
          toast.error(result.error);
          return;
        }
        setStatus("published");
        setPendingChanges(false);
        toast.success(result.message ?? "Publicada");
        router.refresh();
      }),
    );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        save();
      }
    };
    const onUnload = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("beforeunload", onUnload);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("beforeunload", onUnload);
    };
  }, [dirty, save]);

  const selectFromPreview = (id: string) => {
    setSelectedId(id);
    setTab("page");
  };

  const addPageBlock = (type: PageBlockType) => {
    const block = createPageBlock(type);
    update((c) => {
      const index = c.page_blocks.findIndex((b) => b.id === selectedId);
      const blocks = [...c.page_blocks];
      blocks.splice(index === -1 ? blocks.length : index + 1, 0, block);
      return { ...c, page_blocks: blocks };
    });
    setSelectedId(block.id);
    setAdding(null);
  };

  const addFormBlock = (type: FormBlockType) => {
    const block = createFormBlock(type);
    update((c) => ({ ...c, form_blocks: [block, ...c.form_blocks] }));
    setSelectedId(block.id);
    setAdding(null);
  };

  return (
    <div className="-mx-4 -my-6 flex min-h-[calc(100svh-3.5rem)] flex-col md:-mx-8 md:-my-8 md:min-h-svh">
      {/* Barra superior */}
      <div className="sticky top-14 z-20 flex flex-wrap items-center gap-2 border-b bg-background/95 px-4 py-2 backdrop-blur md:top-0">
        <Link href="/dashboard/landings" className="rounded-md p-1.5 hover:bg-muted" aria-label="Volver">
          <ArrowLeft className="size-4" />
        </Link>
        <Input
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            setDirty(true);
          }}
          className="h-8 w-48 font-medium sm:w-64"
          aria-label="Título"
        />
        <SimpleBadge tone={status === "published" ? "success" : "neutral"}>{status === "published" ? "Publicada" : "Borrador"}</SimpleBadge>
        {status === "published" && pendingChanges ? <span className="text-xs text-amber-600">Cambios sin publicar</span> : null}
        {dirty ? <span className="text-xs text-muted-foreground">Sin guardar</span> : null}
        <div className="ml-auto flex items-center gap-2">
          {status === "published" ? (
            <a href={publicPath} target="_blank" rel="noopener noreferrer" className="hidden items-center gap-1 text-sm text-muted-foreground hover:underline sm:flex">
              Ver <ExternalLink className="size-3.5" />
            </a>
          ) : null}
          <Button variant="outline" size="sm" onClick={() => save()} disabled={saving || publishing}>
            {saving && !publishing ? "Guardando…" : "Guardar"}
          </Button>
          <Button size="sm" onClick={publish} disabled={saving || publishing}>
            {publishing ? "Publicando…" : status === "published" ? "Publicar cambios" : "Publicar"}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Más opciones" />}>
              <MoreHorizontal />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => {
                  void navigator.clipboard.writeText(`${window.location.origin}${publicPath}`);
                  toast.success("Link copiado");
                }}
              >
                <Link2 /> Copiar link
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void duplicateLanding(landing.id)}>
                <Copy /> Duplicar landing
              </DropdownMenuItem>
              {status === "published" ? (
                <DropdownMenuItem
                  onClick={async () => {
                    const r = await unpublishLanding(landing.id);
                    if (r.ok) {
                      setStatus("draft");
                      toast.success(r.message ?? "Despublicada");
                    } else toast.error(r.error);
                  }}
                >
                  <Eye /> Despublicar
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onClick={() => {
                  if (confirm("¿Eliminar esta landing? El link dejará de funcionar.")) void deleteLanding(landing.id);
                }}
              >
                <Trash2 /> Eliminar
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="flex flex-1 flex-col lg:flex-row">
        {/* Panel izquierdo */}
        <div className="w-full shrink-0 border-b lg:w-[380px] lg:border-r lg:border-b-0">
          <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} className="gap-0">
            <div className="border-b px-4 pt-3 pb-2">
              <TabsList className="w-full">
                <TabsTrigger value="page">Página</TabsTrigger>
                <TabsTrigger value="form">Formulario</TabsTrigger>
                <TabsTrigger value="style">Estilo</TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="page" className="flex flex-col gap-4 p-4">
              {selectedPage ? (
                <div className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold">{PAGE_BLOCK_LABELS[selectedPage.type]}</p>
                    <Button size="xs" variant="ghost" onClick={() => setSelectedId(null)}>
                      Listo
                    </Button>
                  </div>
                  <PageBlockInspector
                    block={selectedPage}
                    ctx={ctx}
                    onChange={(block) => update((c) => ({ ...c, page_blocks: c.page_blocks.map((b) => (b.id === block.id ? block : b)) }))}
                  />
                </div>
              ) : null}
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Bloques de la página</p>
                <Button size="xs" variant="outline" onClick={() => setAdding("page")}>
                  <Plus /> Agregar
                </Button>
              </div>
              <BlockList
                blocks={content.page_blocks}
                labels={PAGE_BLOCK_LABELS}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onChange={(page_blocks) => update((c) => ({ ...c, page_blocks }))}
              />
              <div className="flex flex-col gap-3 rounded-lg border p-3">
                <ToggleField
                  label="Botón fijo abajo"
                  hint="Sigue al cliente mientras desliza la página"
                  checked={content.sticky_button.enabled}
                  onChange={(enabled) => update((c) => ({ ...c, sticky_button: { ...c.sticky_button, enabled } }))}
                />
                {content.sticky_button.enabled ? (
                  <>
                    <TextField
                      label="Texto"
                      value={content.sticky_button.text}
                      onChange={(text) => update((c) => ({ ...c, sticky_button: { ...c.sticky_button, text } }))}
                    />
                    <TextField
                      label="Subtítulo"
                      value={content.sticky_button.subtext}
                      onChange={(subtext) => update((c) => ({ ...c, sticky_button: { ...c.sticky_button, subtext } }))}
                    />
                    <div className="grid grid-cols-2 gap-3">
                      <ColorField label="Fondo" value={content.sticky_button.bg} onChange={(bg) => update((c) => ({ ...c, sticky_button: { ...c.sticky_button, bg } }))} />
                      <ColorField label="Texto" value={content.sticky_button.color} onChange={(color) => update((c) => ({ ...c, sticky_button: { ...c.sticky_button, color } }))} />
                    </div>
                  </>
                ) : null}
              </div>
            </TabsContent>

            <TabsContent value="form" className="flex flex-col gap-4 p-4">
              {selectedForm ? (
                <div className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold">{FORM_BLOCK_LABELS[selectedForm.type]}</p>
                    <Button size="xs" variant="ghost" onClick={() => setSelectedId(null)}>
                      Listo
                    </Button>
                  </div>
                  <FormBlockInspector
                    block={selectedForm}
                    ctx={ctx}
                    onChange={(block) => update((c) => ({ ...c, form_blocks: c.form_blocks.map((b) => (b.id === block.id ? block : b)) }))}
                  />
                </div>
              ) : null}
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Bloques del formulario</p>
                <Button size="xs" variant="outline" onClick={() => setAdding("form")}>
                  <Plus /> Agregar
                </Button>
              </div>
              <BlockList
                blocks={content.form_blocks}
                labels={FORM_BLOCK_LABELS}
                selectedId={selectedId}
                locked={LOCKED_FORM_BLOCKS}
                onSelect={setSelectedId}
                onChange={(form_blocks) => update((c) => ({ ...c, form_blocks }))}
              />
              <SelectField
                label="El formulario aparece"
                value={content.theme.formMode}
                onChange={(formMode) => update((c) => ({ ...c, theme: { ...c.theme, formMode } }))}
                options={[
                  { value: "popup", label: "En una ventana emergente (recomendado)" },
                  { value: "embedded", label: "Dentro de la página" },
                ]}
              />
              {(offersByProduct[productId] ?? []).length === 0 ? (
                <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                  Este producto no tiene ofertas activas. Agrégalas en el producto para poder publicar.
                </p>
              ) : null}
            </TabsContent>

            <TabsContent value="style" className="flex flex-col gap-4 p-4">
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs">Producto</Label>
                <select
                  value={productId}
                  onChange={(e) => {
                    setProductId(e.target.value);
                    setDirty(true);
                  }}
                  className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
                >
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs">Enlace</Label>
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  /p/{storeSlug}/
                  <Input
                    value={slug}
                    onChange={(e) => {
                      setSlug(slugify(e.target.value));
                      setDirty(true);
                    }}
                    className="h-8"
                  />
                </div>
                {status === "published" ? <p className="text-xs text-amber-600">Si cambias el enlace, el anterior dejará de funcionar en tus anuncios.</p> : null}
              </div>
              <SelectField
                label="Tipografía"
                value={content.theme.font}
                onChange={(font) => update((c) => ({ ...c, theme: { ...c.theme, font } }))}
                options={FONTS.map((f) => ({ value: f, label: f === "system" ? "Del sistema (más rápida)" : f }))}
              />
              <div className="grid grid-cols-2 gap-3">
                <ColorField label="Fondo de la página" value={content.theme.pageBg} onChange={(pageBg) => update((c) => ({ ...c, theme: { ...c.theme, pageBg } }))} />
                <ColorField label="Color de texto" value={content.theme.textColor} onChange={(textColor) => update((c) => ({ ...c, theme: { ...c.theme, textColor } }))} />
              </div>
            </TabsContent>
          </Tabs>
        </div>

        {/* Vista previa */}
        <div className="flex flex-1 flex-col items-center gap-3 bg-muted/40 p-4 lg:p-8">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            Vista previa en celular · toca un bloque para editarlo
          </div>
          {/* translateZ(0): los elementos "fixed" de la vista previa (formulario emergente) quedan dentro del marco */}
          <div className="relative h-[760px] w-[390px] max-w-full [transform:translateZ(0)] overflow-hidden rounded-[2.5rem] border-[10px] border-zinc-900 bg-white shadow-xl">
            <div className="h-full overflow-y-auto overscroll-contain">
              <LandingRenderer
                data={renderData}
                mode="preview"
                selectedBlockId={selectedId}
                onSelectBlock={selectFromPreview}
                forceFormOpen={tab === "form" && content.theme.formMode === "popup"}
              />
            </div>
          </div>
        </div>
      </div>

      <Dialog open={adding !== null} onOpenChange={(open) => !open && setAdding(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Agregar bloque {adding === "form" ? "al formulario" : "a la página"}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-2">
            {adding === "page"
              ? ADDABLE_PAGE_BLOCKS.map((type) => (
                  <button key={type} type="button" onClick={() => addPageBlock(type)} className="rounded-lg border p-3 text-left text-sm font-medium hover:bg-muted">
                    {PAGE_BLOCK_LABELS[type]}
                  </button>
                ))
              : ADDABLE_FORM_BLOCKS.map((type) => (
                  <button key={type} type="button" onClick={() => addFormBlock(type)} className="rounded-lg border p-3 text-left text-sm font-medium hover:bg-muted">
                    {FORM_BLOCK_LABELS[type]}
                  </button>
                ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
