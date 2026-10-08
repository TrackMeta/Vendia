import "server-only";
import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

export type ErrorReport = {
  source: "server" | "client";
  message: string;
  stack?: string | null;
  path?: string | null;
  digest?: string | null;
  userAgent?: string | null;
};

/** Ruta sin ids (uuid, números largos ni query) para agrupar errores iguales en páginas distintas. */
export function routePattern(path: string | null | undefined): string {
  return (path ?? "")
    .split("?")[0]
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ":id")
    .replace(/\/\d{3,}/g, "/:n");
}

/** Huella del error: mismo origen + mensaje (sin números) + ruta = mismo error (se cuenta, no se repite). */
export function errorFingerprint(r: Pick<ErrorReport, "source" | "message" | "path">): string {
  const message = r.message.split("\n")[0].replace(/\d+/g, "#").slice(0, 300);
  return createHash("sha256").update(`${r.source}|${message}|${routePattern(r.path)}`).digest("hex").slice(0, 40);
}

/** Guarda el error en public.app_errors (visible en /admin → Errores). Nunca lanza. */
export async function reportError(r: ErrorReport): Promise<void> {
  try {
    if (!process.env.SUPABASE_SECRET_KEY) return;
    await createAdminClient().rpc("log_app_error", {
      p: {
        fingerprint: errorFingerprint(r),
        source: r.source,
        message: r.message.slice(0, 1000),
        stack: r.stack?.slice(0, 6000) ?? null,
        path: r.path?.slice(0, 500) ?? null,
        digest: r.digest?.slice(0, 100) ?? null,
        user_agent: r.userAgent?.slice(0, 500) ?? null,
      },
    });
  } catch {
    // El registro de errores nunca debe romper la app
  }
}
