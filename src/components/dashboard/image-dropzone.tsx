"use client";

import { Loader2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { type UploadedImage, uploadStoreImage } from "@/lib/upload";

/** Zona para arrastrar y soltar (o elegir) imágenes. Comprime y sube a Supabase Storage. */
export function ImageDropzone({
  storeId,
  folder,
  multiple = true,
  maxSize,
  onUploaded,
  label = "Arrastra imágenes aquí o toca para elegir",
  compact = false,
}: {
  storeId: string;
  folder: string;
  multiple?: boolean;
  maxSize?: number;
  onUploaded: (images: UploadedImage[]) => void | Promise<void>;
  label?: string;
  compact?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(0);

  async function handleFiles(fileList: FileList | null) {
    const files = Array.from(fileList ?? []).filter((f) => f.type.startsWith("image/"));
    if (!files.length) return;
    setUploading(files.length);
    const uploaded: UploadedImage[] = [];
    for (const file of multiple ? files : files.slice(0, 1)) {
      try {
        uploaded.push(await uploadStoreImage(storeId, folder, file, maxSize));
      } catch (e) {
        toast.error(`${file.name}: ${e instanceof Error ? e.message : "error al subir"}`);
      }
      setUploading((n) => n - 1);
    }
    if (uploaded.length) await onUploaded(uploaded);
    setUploading(0);
    if (input.current) input.current.value = "";
  }

  return (
    <button
      type="button"
      onClick={() => input.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        void handleFiles(e.dataTransfer.files);
      }}
      disabled={uploading > 0}
      className={cn(
        "flex w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed text-center text-sm text-muted-foreground transition-colors hover:border-foreground/40 hover:bg-muted/50",
        compact ? "px-3 py-3" : "px-4 py-8",
        dragging && "border-primary bg-primary/5",
      )}
    >
      {uploading > 0 ? <Loader2 className="size-5 animate-spin" /> : <Upload className="size-5" />}
      <span>{uploading > 0 ? `Optimizando y subiendo ${uploading}…` : label}</span>
      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple={multiple}
        className="hidden"
        onChange={(e) => void handleFiles(e.target.files)}
      />
    </button>
  );
}
