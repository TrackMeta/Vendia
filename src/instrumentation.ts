import type { Instrumentation } from "next";

/** Errores del servidor (páginas, API, Server Actions, proxy) → registro propio en /admin → Errores. */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { reportError } = await import("@/lib/report-error");
  const message = err instanceof Error ? err.message : String(err);
  const digest = typeof err === "object" && err !== null && "digest" in err ? String((err as { digest: unknown }).digest) : undefined;
  const ua = request.headers["user-agent"];
  await reportError({
    source: "server",
    message: `${message} [${context.routeType}]`,
    stack: err instanceof Error ? (err.stack ?? null) : null,
    path: request.path,
    digest,
    userAgent: Array.isArray(ua) ? ua[0] : ua,
  });
};
