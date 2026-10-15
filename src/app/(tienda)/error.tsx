"use client";

import { useEffect } from "react";
import { reportClientError } from "@/lib/report-client-error";

/** Si algo falla al mostrar una página: aviso amable + el error queda registrado para el equipo de Vendia. */
export default function ErrorPage({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    reportClientError(error, { digest: error.digest });
  }, [error]);

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-xl font-semibold">Algo salió mal</h1>
      <p className="max-w-sm text-sm text-muted-foreground">Ya registramos el problema para revisarlo. Vuelve a intentarlo; si sigue pasando, escríbenos.</p>
      <button type="button" onClick={() => retry()} className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background">
        Reintentar
      </button>
    </main>
  );
}
