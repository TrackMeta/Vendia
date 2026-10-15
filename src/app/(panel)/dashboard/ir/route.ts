import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getMyStores, STORE_COOKIE } from "@/lib/auth";
import { safeRedirectPath } from "@/lib/safe-redirect";

/**
 * Abrir un aviso de otra tienda (app de celular): cambia a esa tienda y lleva al pedido.
 * /dashboard/ir?tienda=<id>&a=/dashboard/pedidos/<id>. Solo tiendas a las que la persona pertenece.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const to = safeRedirectPath(params.get("a"), "/dashboard/pedidos");
  const response = NextResponse.redirect(new URL(to, request.url));
  const storeId = params.get("tienda") ?? "";
  if (!z.uuid().safeParse(storeId).success) return response;
  const store = (await getMyStores()).find((s) => s.id === storeId);
  if (store) {
    response.cookies.set(STORE_COOKIE, store.id, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 24 * 365,
    });
  }
  return response;
}
