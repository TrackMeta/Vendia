"use client";

import { closestCenter, DndContext, type DragEndEvent, PointerSensor, TouchSensor, useSensor, useSensors } from "@dnd-kit/core";
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowLeft, Copy, CopyPlus, ExternalLink, Eye, GripVertical, Link2, Lock, MoreHorizontal, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { SimpleBadge } from "@/components/dashboard/status-badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { publicAssetUrl } from "@/lib/env";
import { finishSlug, slugifyTyping } from "@/lib/format";
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
import { ImageDropzone } from "@/components/dashboard/image-dropzone";
import { deleteLanding, duplicateLanding, getLandingBlocks, type LandingSettings, publishLanding, saveLanding, unpublishLanding } from "../actions";
import { addAngle, applyAngle, changedBlockIds, clearBlockOverride, setBlockOverride } from "@/modules/landing/angles";
import { AngleBar, AngleBlockList } from "./angle-bar";
import { FormBlockInspector, PageBlockInspector } from "./block-inspector";
import { EditorCard } from "./editor-card";
import { OrderButton } from "@/modules/landing/render/page-blocks";
import { SalesPanel } from "./sales-panel";
import { ColorField, SelectField, TextField, ToggleField } from "@/components/dashboard/fields";
import { AppSelect } from "@/components/dashboard/app-select";

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
  inspector,
  onSelect,
  onDuplicate,
  onDelete,
}: {
  block: AnyBlock;
  label: string;
  selected: boolean;
  locked: boolean;
  inspector?: ReactNode;
  onSelect: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: block.id });
  const thumb = blockThumb(block);
  return (
    <div
      ref={setNodeRef}
      data-block-row={block.id}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("rounded-lg border bg-background", selected && "border-primary ring-2 ring-primary/20", isDragging && "z-10 shadow-lg")}
    >
      <div className="group flex items-center gap-2 px-2 py-1.5">
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
      {selected && inspector ? <div className="border-t bg-muted/30 p-3">{inspector}</div> : null}
    </div>
  );
}

/** El contenedor con scroll más cercano (o la página). */
function scrollParent(el: HTMLElement): Element {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if ((o === "auto" || o === "scroll") && p.scrollHeight > p.clientHeight) return p;
  }
  return document.scrollingElement ?? document.documentElement;
}

function BlockList<T extends AnyBlock>({
  blocks,
  labels,
  selectedId,
  locked = [],
  inspector,
  onSelect,
  onChange,
}: {
  blocks: T[];
  labels: Record<string, string>;
  selectedId: string | null;
  locked?: string[];
  inspector?: ReactNode;
  onSelect: (id: string | null) => void;
  onChange: (blocks: T[]) => void;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } }));
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    onChange(
      arrayMove(
        blocks,
        blocks.findIndex((b) => b.id === e.active.id),
        blocks.findIndex((b) => b.id === e.over!.id),
      ),
    );
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
              inspector={inspector}
              onSelect={() => onSelect(selectedId === block.id ? null : block.id)}
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
  "product_hero",
];
const ADDABLE_FORM_BLOCKS: FormBlockType[] = ["form_image", "form_text", "form_summary", "form_bumps"];

const LEAVE_MESSAGE = "Tienes cambios sin guardar. ¿Salir sin guardar?";

export function LandingBuilder({
  landing,
  storeId,
  storeSlug,
  storeName,
  products,
  offersByProduct,
  pricing,
  otherLandings,
  storeWhatsapp,
  storeConfirmation,
}: {
  landing: {
    id: string;
    title: string;
    slug: string;
    product_id: string;
    status: "draft" | "published";
    content: LandingContent;
    settings: LandingSettings;
    hasUnpublishedChanges: boolean;
  };
  otherLandings: { id: string; title: string; slug: string; status: string }[];
  storeWhatsapp: string | null;
  storeConfirmation: string;
  storeId: string;
  storeSlug: string;
  storeName: string;
  products: {
    id: string;
    name: string;
    price: number;
    compare_at_price: number | null;
    description: string | null;
    images: string[];
    variantLabel: string | null;
    variants: { id: string; name: string; available: boolean }[];
  }[];
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
  const [tab, setTab] = useState<"page" | "form" | "sales" | "style">("page");
  const [settings, setSettings] = useState<LandingSettings>(landing.settings);
  const [copyFrom, setCopyFrom] = useState<null | { landingId: string; blocks: PageBlock[] | null; picked: string[] }>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adding, setAdding] = useState<null | "page" | "form">(null);
  // Ángulo que se edita (null = versión principal)
  const [angleKey, setAngleKey] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const [publishing, startPublishing] = useTransition();
  // Cuenta cada cambio: al terminar de guardar solo se limpia «Sin guardar» si no hubo cambios mientras tanto
  const revision = useRef(0);
  const markDirty = useCallback(() => {
    revision.current += 1;
    setDirty(true);
  }, []);

  const update = useCallback(
    (updater: (c: LandingContent) => LandingContent) => {
      setContent((c) => updater(c));
      markDirty();
      setPendingChanges(true);
    },
    [markDirty],
  );

  // Lo que se ve en la vista previa: la versión principal o el ángulo elegido
  const view = useMemo(() => applyAngle(content, angleKey), [content, angleKey]);
  const changed = useMemo(() => changedBlockIds(content, angleKey), [content, angleKey]);
  const selectedPage = view.page_blocks.find((b) => b.id === selectedId) ?? null;
  const selectedForm = content.form_blocks.find((b) => b.id === selectedId) ?? null;
  const product = products.find((p) => p.id === productId) ?? products[0];
  const publicPath = `/p/${storeSlug}/${slug}`;
  const ctx = { storeId, folder: `landings/${landing.id}`, products };

  const renderData: LandingRenderData = useMemo(
    () => ({
      landingId: null,
      storeName,
      storeSlug,
      landingSlug: slug,
      content: view,
      product: {
        name: product?.name ?? "",
        price: product?.price ?? 0,
        compare_at_price: product?.compare_at_price ?? null,
        description: product?.description ?? null,
        images: product?.images ?? [],
        variantLabel: product?.variantLabel ?? null,
        variants: product?.variants ?? [],
      },
      whatsapp: storeWhatsapp,
      offers: offersByProduct[productId] ?? [],
      shipping: { lima: pricing.shippingLima, province: pricing.shippingProvince },
      advanceAmount: pricing.advance,
    }),
    [view, product, productId, offersByProduct, pricing, slug, storeName, storeSlug, storeWhatsapp],
  );

  const save = useCallback(
    (then?: () => void) =>
      startSaving(async () => {
        const rev = revision.current;
        const cleanSlug = finishSlug(slug);
        if (cleanSlug !== slug) setSlug(cleanSlug);
        const result = await saveLanding(landing.id, { title, slug: cleanSlug, product_id: productId, content, settings });
        if (!result.ok) {
          toast.error(result.error);
          return;
        }
        // El servidor fija el inicio de la prueba de precio: se guarda aquí para no reiniciarla en el próximo guardado
        const priceTestStartedAt = result.priceTestStartedAt;
        if (priceTestStartedAt) {
          setSettings((s) => (s.price_test.enabled && !s.price_test.started_at ? { ...s, price_test: { ...s.price_test, started_at: priceTestStartedAt } } : s));
        }
        if (revision.current === rev) setDirty(false);
        if (then) then();
        else toast.success(result.message ?? "Guardado");
      }),
    [content, landing.id, productId, slug, title, settings],
  );

  const publish = () => {
    const rev = revision.current;
    save(() =>
      startPublishing(async () => {
        const result = await publishLanding(landing.id);
        if (!result.ok) {
          toast.error(result.error);
          return;
        }
        setStatus("published");
        if (revision.current === rev) setPendingChanges(false);
        toast.success(result.message ?? "Publicada");
        router.refresh();
      }),
    );
  };

  const duplicate = async () => {
    if (dirty && !confirm("Tienes cambios sin guardar: la copia usará lo último guardado. ¿Duplicar igual?")) return;
    const r = await duplicateLanding(landing.id);
    // Si sale bien, el servidor redirige a la copia
    if (r && !r.ok) toast.error(r.error);
  };

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
    // Enlaces internos (Volver, menú lateral…): beforeunload no avisa al navegar dentro de la app
    const onLinkClick = (e: MouseEvent) => {
      if (!dirty || e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
      const link = e.target instanceof Element ? e.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!link || (link.target && link.target !== "_self")) return;
      const url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname === window.location.pathname) return;
      if (!confirm(LEAVE_MESSAGE)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("beforeunload", onUnload);
    document.addEventListener("click", onLinkClick, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("beforeunload", onUnload);
      document.removeEventListener("click", onLinkClick, true);
    };
  }, [dirty, save]);

  // Al abrir o cerrar un bloque, la fila tocada se queda en el mismo lugar de la pantalla (sin saltos).
  // Desde la vista previa, la lista se desplaza suave hasta el bloque.
  const anchor = useRef<{ id: string; top: number } | null>(null);
  const reveal = useRef<string | null>(null);
  const selectBlock = (id: string | null) => {
    const target = id ?? selectedId;
    const row = target ? document.querySelector<HTMLElement>(`[data-block-row="${target}"]`) : null;
    anchor.current = row && target ? { id: target, top: row.getBoundingClientRect().top } : null;
    setSelectedId(id);
  };
  useLayoutEffect(() => {
    const a = anchor.current;
    anchor.current = null;
    if (a) {
      const row = document.querySelector<HTMLElement>(`[data-block-row="${a.id}"]`);
      const delta = row ? row.getBoundingClientRect().top - a.top : 0;
      if (row && Math.abs(delta) > 1) scrollParent(row).scrollBy({ top: delta, behavior: "instant" });
    }
    if (reveal.current && reveal.current === selectedId) {
      reveal.current = null;
      document.querySelector<HTMLElement>(`[data-block-row="${selectedId}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [selectedId, tab]);

  const selectFromPreview = (id: string) => {
    reveal.current = id;
    setSelectedId(id);
    setTab("page");
  };

  // Editores: se muestran debajo del bloque elegido
  const doneButton = (
    <Button size="xs" variant="outline" className="self-end" onClick={() => selectBlock(null)}>
      Listo
    </Button>
  );
  const pageInspector = selectedPage ? (
    <div className="flex flex-col gap-3">
      {angleKey ? <p className="text-xs text-primary">Solo cambia en este ángulo.</p> : null}
      <PageBlockInspector
        block={selectedPage}
        ctx={ctx}
        onChange={(block) =>
          angleKey ? update((c) => setBlockOverride(c, angleKey, block)) : update((c) => ({ ...c, page_blocks: c.page_blocks.map((b) => (b.id === block.id ? block : b)) }))
        }
      />
      {doneButton}
    </div>
  ) : null;
  const formInspector = selectedForm ? (
    <div className="flex flex-col gap-3">
      <FormBlockInspector block={selectedForm} ctx={ctx} onChange={(block) => update((c) => ({ ...c, form_blocks: c.form_blocks.map((b) => (b.id === block.id ? block : b)) }))} />
      {doneButton}
    </div>
  ) : null;

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

  /** Varias imágenes de una vez: un bloque de imagen por cada una, en orden. */
  const addImageBlocks = (paths: string[]) => {
    const blocks = paths.map((src) => ({ ...(createPageBlock("image") as Extract<PageBlock, { type: "image" }>), src }));
    update((c) => {
      const index = c.page_blocks.findIndex((b) => b.id === selectedId);
      const next = [...c.page_blocks];
      next.splice(index === -1 ? next.length : index + 1, 0, ...blocks);
      return { ...c, page_blocks: next };
    });
    toast.success(`${blocks.length} bloque(s) de imagen agregados`);
  };

  const openCopy = async (landingId: string) => {
    setCopyFrom({ landingId, blocks: null, picked: [] });
    const r = await getLandingBlocks(landingId);
    if (!r.ok) {
      toast.error(r.error);
      setCopyFrom(null);
      return;
    }
    setCopyFrom({ landingId, blocks: r.blocks, picked: [] });
  };

  const pasteBlocks = () => {
    if (!copyFrom?.blocks) return;
    const copies = copyFrom.blocks.filter((b) => copyFrom.picked.includes(b.id)).map((b) => ({ ...structuredClone(b), id: newBlockId() }));
    update((c) => ({ ...c, page_blocks: [...c.page_blocks, ...copies].slice(0, 80) }));
    toast.success(`${copies.length} bloque(s) copiados al final`);
    setCopyFrom(null);
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
            markDirty();
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
              <DropdownMenuItem onClick={() => void duplicate()}>
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
        {/* Fondo gris con tarjetas y campos blancos: se distingue cada sección y dónde se escribe */}
        <div className="w-full shrink-0 border-b bg-muted/50 lg:w-[380px] lg:border-r lg:border-b-0 dark:bg-muted/20 [&_input:not([type=color]):not([type=checkbox]):not([type=radio])]:bg-background [&_textarea]:bg-background">
          <AngleBar
            content={content}
            active={angleKey}
            mainAngle={settings.angle}
            publicUrl={typeof window === "undefined" ? publicPath : `${window.location.origin}${publicPath}`}
            onSelect={(key) => {
              setAngleKey(key);
              setTab("page");
            }}
            onAdd={(name) => {
              const r = addAngle(content, name);
              if (!r) return toast.error("Máximo 10 ángulos por landing");
              update(() => r.content);
              setAngleKey(r.key);
              setTab("page");
              toast.success("Ángulo creado: toca un bloque y cambia su texto o imagen");
            }}
            onRename={(key, name) => update((c) => ({ ...c, angles: c.angles.map((a) => (a.key === key ? { ...a, name } : a)) }))}
            onDelete={(key) => {
              update((c) => ({ ...c, angles: c.angles.filter((a) => a.key !== key) }));
              setAngleKey(null);
            }}
          />
          <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} className="gap-0">
            <div className="border-b px-4 pt-3 pb-2">
              <TabsList className="w-full">
                <TabsTrigger value="page">Página</TabsTrigger>
                <TabsTrigger value="form">Formulario</TabsTrigger>
                <TabsTrigger value="sales">Ventas</TabsTrigger>
                <TabsTrigger value="style">Estilo</TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="page" className="flex flex-col gap-4 p-4">
              {angleKey ? (
                <>
                  <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Bloques de este ángulo</p>
                  <AngleBlockList
                    blocks={view.page_blocks}
                    changed={changed}
                    selectedId={selectedId}
                    inspector={pageInspector}
                    onSelect={selectBlock}
                    onReset={(id) => update((c) => clearBlockOverride(c, angleKey, id))}
                  />
                  <p className="text-xs text-muted-foreground">Para agregar, quitar o mover bloques vuelve a la versión Principal: valen para todos los ángulos.</p>
                </>
              ) : (
                <>
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
                    inspector={pageInspector}
                    onSelect={selectBlock}
                    onChange={(page_blocks) => update((c) => ({ ...c, page_blocks }))}
                  />
                  <ImageDropzone
                    compact
                    storeId={storeId}
                    folder={ctx.folder}
                    label="Subir varias imágenes (o GIF) de una vez: se crea un bloque por cada una"
                    onUploaded={(imgs) => addImageBlocks(imgs.map((i) => i.path))}
                  />
                  {otherLandings.length ? (
                    <div className="flex items-center gap-2">
                      <CopyPlus className="size-4 text-muted-foreground" />
                      <AppSelect
                        value=""
                        onChange={(e) => e.target.value && void openCopy(e.target.value)}
                        className="h-8 flex-1 rounded-lg border border-input bg-transparent px-2 text-sm"
                        aria-label="Copiar bloques de otra landing"
                      >
                        <option value="">Copiar bloques de otra landing…</option>
                        {otherLandings.map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.title}
                          </option>
                        ))}
                      </AppSelect>
                    </div>
                  ) : null}
                  <EditorCard>
                    <ToggleField
                      label="Botón fijo abajo"
                      hint="Sigue al cliente mientras desliza la página"
                      checked={content.sticky_button.enabled}
                      onChange={(enabled) => update((c) => ({ ...c, sticky_button: { ...c.sticky_button, enabled } }))}
                    />
                    {content.sticky_button.enabled ? (
                      <>
                        {/* Vista previa: así lo ve el cliente */}
                        <div className="rounded-lg border border-dashed bg-muted/40 p-2" aria-hidden>
                          <OrderButton
                            text={content.sticky_button.text || "REALIZA TU PEDIDO"}
                            subtext={content.sticky_button.subtext}
                            bg={content.sticky_button.bg}
                            color={content.sticky_button.color}
                            onClick={() => {}}
                          />
                        </div>
                        <TextField label="Texto" value={content.sticky_button.text} onChange={(text) => update((c) => ({ ...c, sticky_button: { ...c.sticky_button, text } }))} />
                        <TextField
                          label="Subtítulo"
                          value={content.sticky_button.subtext}
                          onChange={(subtext) => update((c) => ({ ...c, sticky_button: { ...c.sticky_button, subtext } }))}
                        />
                        <div className="grid grid-cols-2 gap-3">
                          <ColorField label="Fondo" value={content.sticky_button.bg} onChange={(bg) => update((c) => ({ ...c, sticky_button: { ...c.sticky_button, bg } }))} />
                          <ColorField
                            label="Texto"
                            value={content.sticky_button.color}
                            onChange={(color) => update((c) => ({ ...c, sticky_button: { ...c.sticky_button, color } }))}
                          />
                        </div>
                      </>
                    ) : null}
                  </EditorCard>
                </>
              )}
            </TabsContent>

            <TabsContent value="form" className="flex flex-col gap-4 p-4">
              {angleKey ? <p className="rounded-md bg-muted p-2 text-xs text-muted-foreground">Esta pestaña es común a todas las versiones de la landing.</p> : null}
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
                inspector={formInspector}
                onSelect={selectBlock}
                onChange={(form_blocks) => update((c) => ({ ...c, form_blocks }))}
              />
              <EditorCard title="Cómo se abre el formulario">
                <SelectField
                  label="El formulario aparece"
                  value={content.theme.formMode}
                  onChange={(formMode) => update((c) => ({ ...c, theme: { ...c.theme, formMode } }))}
                  options={[
                    { value: "popup", label: "En una ventana emergente (recomendado)" },
                    { value: "embedded", label: "Dentro de la página" },
                  ]}
                />
              </EditorCard>
              {(offersByProduct[productId] ?? []).length === 0 ? (
                <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                  Este producto no tiene ofertas activas. Agrégalas en el producto para poder publicar.
                </p>
              ) : null}
            </TabsContent>

            <TabsContent value="sales" className="flex flex-col gap-4 p-4">
              {angleKey ? <p className="rounded-md bg-muted p-2 text-xs text-muted-foreground">Esta pestaña es común a todas las versiones de la landing.</p> : null}
              <SalesPanel
                content={content}
                update={update}
                settings={settings}
                onSettings={(s) => {
                  setSettings(s);
                  markDirty();
                }}
                landingId={landing.id}
                otherLandings={otherLandings}
                storeWhatsapp={storeWhatsapp}
                storeConfirmation={storeConfirmation}
                ctx={ctx}
                offers={offersByProduct[productId] ?? []}
              />
            </TabsContent>

            <TabsContent value="style" className="flex flex-col gap-4 p-4">
              {angleKey ? <p className="rounded-md bg-muted p-2 text-xs text-muted-foreground">Esta pestaña es común a todas las versiones de la landing.</p> : null}
              <EditorCard title="Producto y enlace" hint="Qué producto vende esta landing y su dirección.">
                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs">Producto</Label>
                  <AppSelect
                    value={productId}
                    onChange={(e) => {
                      setProductId(e.target.value);
                      markDirty();
                    }}
                    className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
                  >
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </AppSelect>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs">Enlace</Label>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    /p/{storeSlug}/
                    <Input
                      value={slug}
                      onChange={(e) => {
                        // Mientras se escribe se permite el guion final; al salir del campo se limpia
                        setSlug(slugifyTyping(e.target.value));
                        markDirty();
                      }}
                      onBlur={() => setSlug((v) => finishSlug(v))}
                      className="h-8"
                    />
                  </div>
                  {status === "published" ? <p className="text-xs text-amber-600">Si cambias el enlace, el anterior dejará de funcionar en tus anuncios.</p> : null}
                </div>
              </EditorCard>
              <EditorCard title="Letra" hint="La tipografía de toda la landing.">
                <SelectField
                  label="Tipografía"
                  value={content.theme.font}
                  onChange={(font) => update((c) => ({ ...c, theme: { ...c.theme, font } }))}
                  options={FONTS.map((f) => ({ value: f, label: f === "system" ? "Del sistema (más rápida)" : f }))}
                />
              </EditorCard>
              <EditorCard title="Colores de la página" hint="El fondo y el texto general. Cada bloque puede tener sus propios colores.">
                {/* Vista previa de la combinación */}
                <div className="rounded-lg border p-3 text-sm" style={{ backgroundColor: content.theme.pageBg, color: content.theme.textColor }} aria-hidden>
                  <p className="font-semibold">Así se ve el texto de tu landing</p>
                  <p className="text-xs opacity-80">Envío a todo el Perú · Pagas al recibir</p>
                </div>
                <ColorField label="Fondo de la página" value={content.theme.pageBg} onChange={(pageBg) => update((c) => ({ ...c, theme: { ...c.theme, pageBg } }))} />
                <ColorField label="Color de texto" value={content.theme.textColor} onChange={(textColor) => update((c) => ({ ...c, theme: { ...c.theme, textColor } }))} />
              </EditorCard>
            </TabsContent>
          </Tabs>
        </div>

        {/* Vista previa */}
        <div className="flex flex-1 flex-col items-center gap-3 bg-muted/40 p-4 lg:p-8">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            Vista previa en celular · {angleKey ? `ángulo «${content.angles.find((a) => a.key === angleKey)?.name ?? ""}»` : "versión principal"} · toca un bloque para editarlo
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
            {adding === "page" ? (
              <>
                {ADDABLE_PAGE_BLOCKS.map((type) => (
                  <button key={type} type="button" onClick={() => addPageBlock(type)} className="rounded-lg border p-3 text-left text-sm font-medium hover:bg-muted">
                    {PAGE_BLOCK_LABELS[type]}
                  </button>
                ))}
                <span className="rounded-lg border border-dashed p-3 text-left text-sm text-muted-foreground">
                  Video <span className="block text-xs">Próximamente · por ahora usa un GIF en un bloque de imagen</span>
                </span>
              </>
            ) : (
              ADDABLE_FORM_BLOCKS.filter((type) => type !== "form_bumps" || !content.form_blocks.some((b) => b.type === "form_bumps")).map((type) => (
                <button key={type} type="button" onClick={() => addFormBlock(type)} className="rounded-lg border p-3 text-left text-sm font-medium hover:bg-muted">
                  {FORM_BLOCK_LABELS[type]}
                </button>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={copyFrom !== null} onOpenChange={(open) => !open && setCopyFrom(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Copiar bloques de «{otherLandings.find((l) => l.id === copyFrom?.landingId)?.title}»</DialogTitle>
          </DialogHeader>
          {!copyFrom?.blocks ? (
            <p className="text-sm text-muted-foreground">Cargando bloques…</p>
          ) : (
            <div className="flex max-h-96 flex-col gap-1.5 overflow-y-auto">
              {copyFrom.blocks.map((b) => {
                const checked = copyFrom.picked.includes(b.id);
                const thumb = blockThumb(b);
                return (
                  <label key={b.id} className="flex items-center gap-2 rounded-lg border px-2 py-1.5 text-sm">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => setCopyFrom((s) => (s ? { ...s, picked: checked ? s.picked.filter((x) => x !== b.id) : [...s.picked, b.id] } : s))}
                      className="size-4"
                    />
                    {thumb ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={thumb} alt="" className="size-8 rounded object-cover" />
                    ) : null}
                    <span className="flex min-w-0 flex-col">
                      <span className="font-medium">{PAGE_BLOCK_LABELS[b.type]}</span>
                      <span className="truncate text-xs text-muted-foreground">{blockSummary(b)}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setCopyFrom(null)}>
              Cancelar
            </Button>
            <Button disabled={!copyFrom?.picked.length} onClick={pasteBlocks}>
              Copiar {copyFrom?.picked.length || ""} bloque(s)
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
