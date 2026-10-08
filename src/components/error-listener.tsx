"use client";

import { useEffect } from "react";
import { reportClientError } from "@/lib/report-client-error";

/** Escucha errores no capturados del navegador y los registra (solo errores de nuestros scripts). */
export function ErrorListener() {
  useEffect(() => {
    const onError = (e: ErrorEvent) => {
      // Errores de scripts de otros dominios (Pixel, extensiones) llegan sin datos: se ignoran
      if (!e.error && (!e.filename || !e.filename.startsWith(location.origin))) return;
      reportClientError(e.error ?? e.message);
    };
    const onRejection = (e: PromiseRejectionEvent) => reportClientError(e.reason);
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  return null;
}
