"use client";

import imageCompression from "browser-image-compression";
import { compressionPlan, DEFAULT_MAX_WIDTH } from "@/lib/image-sizing";
import { createClient } from "@/lib/supabase/client";

const BUCKET = "store-assets";

/**
 * Comprime a WebP antes de subir: ancho máx. 1080 px (suficiente para celular a 2x)
 * y ~250 KB por imagen. Menos peso = landing más rápida y menos transferencia en Supabase.
 */
export async function compressImage(file: File, maxWidth = DEFAULT_MAX_WIDTH): Promise<File> {
  if (file.type === "image/gif" || file.type === "image/svg+xml" || file.type === "image/x-icon") return file;
  const size = await readSize(file);
  const plan = compressionPlan(size?.width ?? 0, size?.height ?? 0, maxWidth);
  return imageCompression(file, {
    maxWidthOrHeight: plan.maxWidthOrHeight,
    maxSizeMB: plan.maxSizeMB,
    fileType: "image/webp",
    initialQuality: 0.8,
    useWebWorker: true,
  });
}

async function readSize(file: Blob): Promise<{ width: number; height: number } | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    return null;
  }
}

export type UploadedImage = { path: string; width: number | null; height: number | null };

/**
 * Sube una imagen a store-assets/{storeId}/{folder}/...
 * La política de Storage solo permite escribir en la carpeta de tu tienda.
 */
export async function uploadStoreImage(storeId: string, folder: string, file: File, maxSize = DEFAULT_MAX_WIDTH): Promise<UploadedImage> {
  if (!file.type.startsWith("image/")) throw new Error("El archivo debe ser una imagen");
  if (file.size > 15 * 1024 * 1024) throw new Error("La imagen pesa más de 15 MB");
  // Los GIF se suben tal cual (recomprimirlos rompe la animación): máximo 5 MB
  if (file.type === "image/gif" && file.size > 5 * 1024 * 1024) throw new Error("El GIF pesa más de 5 MB. Redúcelo (por ejemplo en ezgif.com) y vuelve a subirlo.");

  const compressed = await compressImage(file, maxSize);
  const ext = compressed.type === "image/webp" ? "webp" : (compressed.name.split(".").pop() ?? "img");
  const path = `${storeId}/${folder}/${crypto.randomUUID()}.${ext}`;
  const size = await readSize(compressed);

  const supabase = createClient();
  const { error } = await supabase.storage.from(BUCKET).upload(path, compressed, {
    contentType: compressed.type,
    cacheControl: "31536000",
    upsert: false,
  });
  if (error) throw new Error("No se pudo subir la imagen");

  return { path, width: size?.width ?? null, height: size?.height ?? null };
}
