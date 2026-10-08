import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isAppHost, isPassthroughPath, rewriteForDomain } from "@/modules/domains";

const AUTH_PAGES = ["/login", "/registro", "/recuperar"];
const SESSION_PATHS = ["/dashboard", "/onboarding", "/admin", "/rotulos", "/auth", ...AUTH_PAGES];

type DomainTarget = { storeSlug: string | null; allStores: boolean } | null;

// Caché en memoria de dominios propios (1 minuto): evita consultar la base en cada visita
const domainCache = new Map<string, { at: number; target: DomainTarget }>();
const DOMAIN_TTL_MS = 60_000;

async function rpc<T>(fn: string, body: Record<string, string>): Promise<T | null> {
  const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(3000),
  });
  if (!res.ok) return null;
  return (await res.json()) as T | null;
}

async function resolveDomain(host: string): Promise<DomainTarget> {
  const cached = domainCache.get(host);
  if (cached && Date.now() - cached.at < DOMAIN_TTL_MS) return cached.target;
  let target: DomainTarget = null;
  try {
    const r = await rpc<{ store_slug: string | null; all_stores: boolean }>("resolve_custom_domain", { p_domain: host });
    target = r ? { storeSlug: r.store_slug, allStores: r.all_stores } : null;
  } catch {
    target = cached?.target ?? null;
  }
  domainCache.set(host, { at: Date.now(), target });
  return target;
}

/** Dominio propio de un vendedor → su landing (el panel siempre está en el dominio de Vendia). */
async function handleCustomDomain(request: NextRequest, host: string) {
  const { pathname } = request.nextUrl;
  if (isPassthroughPath(pathname)) return NextResponse.next();
  const target = await resolveDomain(host);
  if (!target) return new NextResponse("Dominio no configurado en Vendia", { status: 404 });
  const rewrite = rewriteForDomain(pathname, target);
  if (!rewrite) return new NextResponse("Página no encontrada", { status: 404 });
  if (target.allStores) {
    // Un dominio «para todas mis tiendas» solo sirve tiendas de ese mismo usuario
    const ok = await rpc<boolean>("domain_serves_store", { p_domain: host, p_store_slug: rewrite.storeSlug }).catch(() => false);
    if (!ok) return new NextResponse("Página no encontrada", { status: 404 });
  }
  const url = request.nextUrl.clone();
  url.pathname = rewrite.path;
  return NextResponse.rewrite(url);
}

/**
 * 1. Dominios propios: reescribe a la landing de la tienda.
 * 2. Panel: refresca la sesión de Supabase y hace redirecciones optimistas.
 *    La autorización real está en el servidor (requireStore) y en RLS.
 */
export async function proxy(request: NextRequest) {
  const host = (request.headers.get("host") ?? "").toLowerCase().replace(/:\d+$/, "");
  if (host && !isAppHost(host, process.env.NEXT_PUBLIC_SITE_URL)) return handleCustomDomain(request, host);

  const { pathname } = request.nextUrl;
  if (!SESSION_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return NextResponse.next();

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
          Object.entries(headers ?? {}).forEach(([key, value]) => response.headers.set(key, value));
        },
      },
    },
  );

  const { data } = await supabase.auth.getClaims();
  const isLoggedIn = Boolean(data?.claims?.sub);

  if (!isLoggedIn && (pathname.startsWith("/dashboard") || pathname.startsWith("/onboarding") || pathname.startsWith("/admin") || pathname.startsWith("/rotulos"))) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (isLoggedIn && AUTH_PAGES.includes(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  // Todo menos archivos estáticos de Next: los dominios propios pueden pedir cualquier ruta.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
