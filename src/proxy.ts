import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isAppHost, isPassthroughPath, rewriteForDomain, type DomainTarget } from "@/modules/domains";

const AUTH_PAGES = ["/login", "/registro", "/recuperar"];
const SESSION_PATHS = ["/dashboard", "/onboarding", "/admin", "/rotulos", "/auth", ...AUTH_PAGES];

/** Dominio activo, o www.<dominio> que lleva al dominio sin www. */
type Resolved = { target: DomainTarget } | { redirectTo: string } | null;

// Caché en memoria de dominios propios: evita consultar la base en cada visita.
// Un dominio encontrado se guarda 1 minuto; uno no encontrado solo 10 s (por si se acaba de activar).
const domainCache = new Map<string, { at: number; value: Resolved }>();
const DOMAIN_TTL_MS = 60_000;
const MISSING_TTL_MS = 10_000;

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
  // Una falla de la base (5xx, 429…) no es «dominio no configurado»: no se guarda en caché
  if (!res.ok) throw new Error(`Supabase respondió ${res.status}`);
  return (await res.json()) as T | null;
}

type ResolveRow = {
  store_slug?: string | null;
  all_stores?: boolean;
  root_store_slug?: string | null;
  root_landing_slug?: string | null;
  redirect_to?: string;
};

async function resolveDomain(host: string): Promise<Resolved> {
  const cached = domainCache.get(host);
  if (cached && Date.now() - cached.at < (cached.value ? DOMAIN_TTL_MS : MISSING_TTL_MS)) return cached.value;
  let value: Resolved = null;
  try {
    const r = await rpc<ResolveRow>("resolve_custom_domain", { p_domain: host });
    if (r?.redirect_to) value = { redirectTo: r.redirect_to };
    else if (r) {
      value = {
        target: {
          storeSlug: r.store_slug ?? null,
          allStores: Boolean(r.all_stores),
          root: r.root_store_slug && r.root_landing_slug ? { storeSlug: r.root_store_slug, landingSlug: r.root_landing_slug } : null,
        },
      };
    }
  } catch {
    // Sin respuesta de la base: se usa lo último que se supo (sin renovar la caché)
    return cached?.value ?? null;
  }
  domainCache.set(host, { at: Date.now(), value });
  return value;
}

const notFound = (text: string) => new NextResponse(text, { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });

/** Dominio propio de un vendedor → su landing (el panel siempre está en el dominio de Vendia). */
async function handleCustomDomain(request: NextRequest, host: string) {
  const { pathname } = request.nextUrl;
  if (pathname.startsWith("/p/")) {
    // Ruta normal de landing en un dominio propio: solo las tiendas de ese dominio (no la de otro vendedor)
    const storeSlug = pathname.split("/")[2] ?? "";
    const resolved = await resolveDomain(host);
    if (!resolved) return notFound("Dominio no configurado en Vendia");
    if ("redirectTo" in resolved) return redirectToApex(request, resolved.redirectTo);
    const { target } = resolved;
    const ok = target.allStores
      ? await rpc<boolean>("domain_serves_store", { p_domain: host, p_store_slug: storeSlug }).catch(() => false)
      : target.storeSlug === storeSlug;
    return ok ? NextResponse.next() : notFound("Página no encontrada");
  }
  if (isPassthroughPath(pathname)) return NextResponse.next();
  const resolved = await resolveDomain(host);
  if (!resolved) return notFound("Dominio no configurado en Vendia");
  if ("redirectTo" in resolved) return redirectToApex(request, resolved.redirectTo);
  const { target } = resolved;
  const rewrite = rewriteForDomain(pathname, target);
  if (!rewrite) {
    return notFound(pathname === "/" ? "Esta tienda todavía no tiene una página publicada" : "Página no encontrada");
  }
  if (target.allStores && !rewrite.root) {
    // Un dominio «para todas mis tiendas» solo sirve tiendas de ese mismo usuario
    const ok = await rpc<boolean>("domain_serves_store", { p_domain: host, p_store_slug: rewrite.storeSlug }).catch(() => false);
    if (!ok) return notFound("Página no encontrada");
  }
  const url = request.nextUrl.clone();
  url.pathname = rewrite.path;
  return NextResponse.rewrite(url);
}

/** www.tienda.pe/… → https://tienda.pe/… (308: una sola dirección para cada página). */
function redirectToApex(request: NextRequest, apex: string) {
  const url = new URL(request.nextUrl.pathname + request.nextUrl.search, `https://${apex}`);
  return NextResponse.redirect(url, 308);
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
    url.search = "";
    url.searchParams.set("next", pathname + request.nextUrl.search);
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
