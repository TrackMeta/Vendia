import type { NextConfig } from "next";

const supabaseHost = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname
  : undefined;

const nextConfig: NextConfig = {
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  images: {
    remotePatterns: supabaseHost
      ? [{ protocol: "https", hostname: supabaseHost, pathname: "/storage/v1/object/public/**" }]
      : [],
  },
  // Archivos que casi no cambian: el navegador y la CDN los guardan (las landings cargan más rápido)
  async headers() {
    return [
      { source: "/ubigeo-pe.json", headers: [{ key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" }] },
      { source: "/couriers/:file*", headers: [{ key: "Cache-Control", value: "public, max-age=86400" }] },
    ];
  },
  experimental: {
    serverActions: {
      // Las imágenes se suben directo a Supabase Storage desde el navegador;
      // las Server Actions solo reciben JSON.
      bodySizeLimit: "2mb",
    },
  },
};

export default nextConfig;
