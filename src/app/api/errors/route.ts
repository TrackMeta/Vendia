import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { reportError } from "@/lib/report-error";

const schema = z.object({
  message: z.string().min(1).max(1000),
  stack: z.string().max(6000).optional(),
  path: z.string().max(500).optional(),
  digest: z.string().max(100).optional(),
});

/** Errores del navegador (landing y panel). Se agrupan por huella en public.app_errors. */
export async function POST(request: NextRequest) {
  const raw = await request.text();
  if (raw.length > 8000) return new NextResponse(null, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return new NextResponse(null, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return new NextResponse(null, { status: 400 });
  // Ruido de extensiones del navegador y scripts de terceros: no es un error de Vendia
  if (/^(Script error\.?|ResizeObserver loop)/i.test(parsed.data.message)) return new NextResponse(null, { status: 204 });
  await reportError({ source: "client", ...parsed.data, userAgent: request.headers.get("user-agent") });
  return new NextResponse(null, { status: 204 });
}
