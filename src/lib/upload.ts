"use client";

import imageCompression from "browser-image-compression";
import { createClient } from "@/lib/supabase/client";

const BUCKET = "store-assets";

/** Comprime a WebP (máx. 1600 px de ancho) antes de subir: landings rápidas en celular. */
export async function compressImage(file: File, maxWidthOrHeight = 1600): Promise<File> {
  if (file.type === "image/gif" || file.type === "image/svg+xml" || file.type === "image/x-icon") return file;
  return imageCompression(file, {
    maxWidthOrHeight,
    maxSizeMB: 0.6,
    fileType: "image/webp",
    initialQuality: 0.82,
    useWebWorker: true,
  });
}

async function readSize(file: File): Promise<{ width: number; height: number } | null> {
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
export async function uploadStoreImage(storeId: string, folder: string, file: File, maxSize = 1600): Promise<UploadedImage> {
  if (!file.type.startsWith("image/")) throw new Error("El archivo debe ser una imagen");
  if (file.size > 15 * 1024 * 1024) throw new Error("La imagen pesa más de 15 MB");

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
