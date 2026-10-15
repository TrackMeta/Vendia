"use client";

import { closestCenter, DndContext, type DragEndEvent, PointerSensor, TouchSensor, useSensor, useSensors } from "@dnd-kit/core";
import { arrayMove, rectSortingStrategy, SortableContext, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Star, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ImageDropzone } from "@/components/dashboard/image-dropzone";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { publicAssetUrl } from "@/lib/env";
import { cn } from "@/lib/utils";
import { addProductImages, deleteProductImage, reorderProductImages } from "../actions";

type Img = { id: string; storage_path: string; is_primary: boolean; position: number };

function SortableImage({
  image,
  onDelete,
  onPrimary,
}: {
  image: Img;
  onDelete: () => void;
  onPrimary: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: image.id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("group relative overflow-hidden rounded-lg border bg-muted", isDragging && "z-10 opacity-80 shadow-lg")}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={publicAssetUrl(image.storage_path)!} alt="" className="aspect-square w-full object-cover" />
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label="Arrastrar para ordenar"
        className="absolute top-1 left-1 cursor-grab touch-none rounded bg-white/90 p-1 text-zinc-700 shadow"
      >
        <GripVertical className="size-4" />
      </button>
      {image.is_primary ? (
        <span className="absolute bottom-1 left-1 rounded bg-primary px-1.5 py-0.5 text-[10px] font-medium text-primary-foreground">Principal</span>
      ) : null}
      <div className="absolute top-1 right-1 flex gap-1">
        {!image.is_primary ? (
          <button type="button" onClick={onPrimary} aria-label="Hacer principal" className="rounded bg-white/90 p-1 text-zinc-700 shadow hover:text-amber-500">
            <Star className="size-4" />
          </button>
        ) : null}
        <button type="button" onClick={onDelete} aria-label="Eliminar" className="rounded bg-white/90 p-1 text-zinc-700 shadow hover:text-red-600">
          <Trash2 className="size-4" />
        </button>
      </div>
    </div>
  );
}

export function ImagesManager({ storeId, productId, images: initial }: { storeId: string; productId: string; images: Img[] }) {
  const [images, setImages] = useState(initial);
  const [, startTransition] = useTransition();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(TouchSensor));

  const [prevInitial, setPrevInitial] = useState(initial);
  if (initial !== prevInitial) {
    setPrevInitial(initial);
    setImages(initial);
  }

  function persistOrder(next: Img[], primaryId: string | null = null) {
    startTransition(async () => {
      const result = await reorderProductImages(productId, next.map((i) => i.id), primaryId);
      if (!result.ok) toast.error(result.error);
    });
  }

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const next = arrayMove(images, images.findIndex((i) => i.id === active.id), images.findIndex((i) => i.id === over.id));
    setImages(next);
    persistOrder(next);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Imágenes</CardTitle>
        <CardDescription>Se optimizan automáticamente para celular (WebP). La principal se usa al compartir el link.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {images.length ? (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={images.map((i) => i.id)} strategy={rectSortingStrategy}>
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
                {images.map((image) => (
                  <SortableImage
                    key={image.id}
                    image={image}
                    onPrimary={() => {
                      const next = images.map((i) => ({ ...i, is_primary: i.id === image.id }));
                      setImages(next);
                      persistOrder(next, image.id);
                    }}
                    onDelete={() => {
                      if (!confirm("¿Eliminar esta imagen?")) return;
                      setImages((list) => list.filter((i) => i.id !== image.id));
                      startTransition(async () => {
                        const result = await deleteProductImage(productId, image.id);
                        if (!result.ok) toast.error(result.error);
                      });
                    }}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        ) : null}
        <ImageDropzone
          storeId={storeId}
          folder={`products/${productId}`}
          onUploaded={async (uploaded) => {
            const result = await addProductImages(productId, uploaded);
            if (!result.ok) toast.error(result.error);
            else toast.success(uploaded.length === 1 ? "Imagen subida" : `${uploaded.length} imágenes subidas`);
          }}
        />
      </CardContent>
    </Card>
  );
}
