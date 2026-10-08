/**
 * Crea un usuario de PRUEBA (correo ya confirmado) para probar la app en local.
 * Guarda las credenciales en .env.test.local (no se sube a GitHub).
 * Uso: npx tsx scripts/create-test-user.ts
 */
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
  auth: { persistSession: false },
});

async function main() {
  const email = `demo-${Date.now().toString(36)}@vendia.test`;
  const password = `Demo-${randomBytes(9).toString("base64url")}`;
  const { error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: "Tienda Demo" },
  });
  if (error) throw error;
  writeFileSync(".env.test.local", `# Usuario de prueba local (no usar en producción)\nTEST_USER_EMAIL=${email}\nTEST_USER_PASSWORD=${password}\n`);
  console.log(`Usuario de prueba creado: ${email} (contraseña en .env.test.local)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
