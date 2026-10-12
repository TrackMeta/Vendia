"use client";

import { ExternalLink, FileText } from "lucide-react";
import { useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

/**
 * Comprobante de pago con vista previa: miniatura en la fila y, al tocarla, se abre grande en la
 * misma página (sin pestaña nueva). Los PDF se ven dentro de la ventana.
 */
export function ReceiptPreview({ url, isPdf, title = "Comprobante" }: { url: string; isPdf: boolean; title?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group flex items-center gap-1.5 rounded-md text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        aria-label={`Ver ${title.toLowerCase()}`}
      >
        {isPdf ? (
          <span className="flex size-9 items-center justify-center rounded-md border bg-muted">
            <FileText className="size-4" aria-hidden />
          </span>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- URL firmada temporal de Storage: no pasa por el optimizador
          <img src={url} alt="" className="size-9 rounded-md border object-cover transition group-hover:brightness-90" loading="lazy" />
        )}
        <span>{title}</span>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="gap-3 sm:max-w-2xl">
          <DialogTitle>{title}</DialogTitle>
          {isPdf ? (
            <iframe src={url} title={title} className="h-[70vh] w-full rounded-md border bg-white" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element -- URL firmada temporal de Storage
            <img src={url} alt={title} className="max-h-[75vh] w-full rounded-md object-contain" />
          )}
          <a href={url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 self-start text-xs text-muted-foreground hover:underline">
            <ExternalLink className="size-3.5" aria-hidden /> Abrir en otra pestaña
          </a>
        </DialogContent>
      </Dialog>
    </>
  );
}
