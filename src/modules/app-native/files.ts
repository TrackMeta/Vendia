import { toast } from "sonner";
import { isNativeApp, vendiaNativo } from "./client";

function toBase64(bytes: Uint8Array): string {
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(s);
}

/**
 * Descarga un archivo (Excel del courier, CSV…). En el navegador, la descarga de siempre;
 * en la app de celular se guarda en Descargas y ofrece «Compartir» (WhatsApp, Drive…).
 */
export async function saveFile(data: Uint8Array | Blob, fileName: string, mime = "application/octet-stream") {
  const native = isNativeApp() ? vendiaNativo() : undefined;
  if (native) {
    const bytes = data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : data;
    const file = { base64: toBase64(bytes), nombre: fileName, mime: (data instanceof Blob && data.type ? data.type : mime).split(";")[0].trim() };
    try {
      const saved = await native.guardarArchivo(file);
      toast.success(`Guardado en Descargas: ${saved?.nombre ?? fileName}`, {
        action: { label: "Compartir", onClick: () => void native.compartirArchivo(file).catch(() => toast.error("No se pudo compartir")) },
        duration: 8000,
      });
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : "No se pudo guardar el archivo");
    }
    return;
  }
  const blob = data instanceof Blob ? data : new Blob([data as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

const MIME: Record<string, string> = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel",
  csv: "text/csv",
  pdf: "application/pdf",
};

/** Tipo del archivo por su extensión (para que el celular sepa con qué app abrirlo). */
export function mimeFor(fileName: string): string {
  return MIME[fileName.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";
}

/** Nombre del archivo que manda el servidor (Content-Disposition: attachment; filename="..."). */
export function fileNameFrom(disposition: string | null, fallback: string): string {
  const star = disposition?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (star) {
    try {
      return decodeURIComponent(star);
    } catch {}
  }
  return disposition?.match(/filename="?([^";]+)"?/i)?.[1] ?? fallback;
}

/** Imprimir: en la app, la ventana de impresión de Android (deja guardar como PDF). */
export function printPage(title = "Vendia") {
  const native = isNativeApp() ? vendiaNativo() : undefined;
  if (native) {
    void native.imprimir({ titulo: title }).catch(() => toast.error("No se pudo abrir la impresión"));
    return;
  }
  window.print();
}
