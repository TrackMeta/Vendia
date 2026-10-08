/**
 * Aplica las migraciones de supabase/migrations a la base de datos de .env.local
 * usando la CLI oficial de Supabase (registra el historial en supabase_migrations).
 * Uso: npm run db:migrate            (aplicar)
 *      npm run db:migrate -- --dry-run (solo mostrar qué se aplicaría)
 */
import { spawnSync } from "node:child_process";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) {
  console.error("Falta SUPABASE_DB_URL en .env.local");
  process.exit(1);
}

const extra = process.argv.slice(2);
const result = spawnSync("npx", ["supabase", "db", "push", "--db-url", dbUrl, "--include-all", "--yes", ...extra], {
  stdio: "inherit",
  shell: process.platform === "win32",
});
process.exit(result.status ?? 1);
