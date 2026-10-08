import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";

const SIZES = new Set([180, 192, 512]);

/** Íconos de la app (PWA): «V» blanca sobre fondo negro. maskable deja margen para recortes redondos. */
export async function GET(request: NextRequest, ctx: RouteContext<"/icons/[size]">) {
  const { size: raw } = await ctx.params;
  const size = SIZES.has(Number(raw)) ? Number(raw) : 192;
  const maskable = request.nextUrl.searchParams.get("maskable") === "1";
  const glyph = Math.round(size * (maskable ? 0.42 : 0.56));
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#111111",
          borderRadius: maskable ? 0 : Math.round(size * 0.22),
        }}
      >
        <span style={{ color: "#ffffff", fontSize: glyph, fontWeight: 800, letterSpacing: -glyph * 0.04, marginTop: -glyph * 0.06 }}>V</span>
        <span style={{ position: "absolute", width: size * 0.09, height: size * 0.09, borderRadius: 999, background: "#16a34a", right: size * (maskable ? 0.3 : 0.2), bottom: size * (maskable ? 0.3 : 0.2) }} />
      </div>
    ),
    { width: size, height: size, headers: { "Cache-Control": "public, max-age=604800, immutable" } },
  );
}
