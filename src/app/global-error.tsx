"use client";

import { useEffect } from "react";
import { reportClientError } from "@/lib/report-client-error";

/** Error en el layout raíz: página mínima (sin los estilos de la app) y registro del error. */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    reportClientError(error, { digest: error.digest });
  }, [error]);

  return (
    <html lang="es">
      <body style={{ fontFamily: "system-ui, sans-serif", display: "grid", placeItems: "center", minHeight: "100vh", margin: 0, textAlign: "center" }}>
        <div>
          <title>Algo salió mal · Vendia</title>
          <h1 style={{ fontSize: 20 }}>Algo salió mal</h1>
          <p style={{ color: "#666", fontSize: 14 }}>Ya registramos el problema. Vuelve a intentarlo en un momento.</p>
          <button type="button" onClick={() => retry()} style={{ padding: "8px 16px", borderRadius: 8, border: 0, background: "#111", color: "#fff" }}>
            Reintentar
          </button>
        </div>
      </body>
    </html>
  );
}
