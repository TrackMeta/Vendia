import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";

const SIZES = new Set([32, 180, 192, 512]);

/**
 * Íconos de Vendia (favicon y app instalable): «V» blanca sobre rojo de marca.
 * maskable deja margen para los recortes redondos de Android.
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/icons/[size]">) {
  const { size: raw } = await ctx.params;
  const size = SIZES.has(Number(raw)) ? Number(raw) : 192;
  const maskable = request.nextUrl.searchParams.get("maskable") === "1";
  const glyph = Math.round(size * (maskable ? 0.46 : 0.62));
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#e53935",
          borderRadius: maskable ? 0 : Math.round(size * 0.22),
        }}
      >
        <span style={{ color: "#ffffff", fontSize: glyph, fontWeight: 800, letterSpacing: -glyph * 0.04, marginTop: -glyph * 0.04 }}>V</span>
      </div>
    ),
    { width: size, height: size, headers: { "Cache-Control": "public, max-age=604800, immutable" } },
  );
}
