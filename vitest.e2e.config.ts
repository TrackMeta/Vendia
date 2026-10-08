import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Pruebas de punta a punta: hablan por HTTP con la app corriendo (next start)
 * y con la base de datos de Supabase (.env.local). URL: E2E_BASE_URL (por defecto http://localhost:3001).
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url)),
    },
  },
  test: {
    include: ["tests/e2e/**/*.test.ts"],
    environment: "node",
    testTimeout: 60_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
