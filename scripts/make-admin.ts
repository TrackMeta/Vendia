/**
 * Da permisos de administrador de la plataforma a un usuario existente.
 * Uso: npx tsx scripts/make-admin.ts tu@correo.com
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email) throw new Error("Uso: npx tsx scripts/make-admin.ts tu@correo.com");
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
  for (let page = 1; page < 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const user = data.users.find((u) => u.email?.toLowerCase() === email);
    if (user) {
      const { error: insertError } = await admin.from("platform_admins").upsert({ user_id: user.id });
      if (insertError) throw insertError;
      console.log(`✓ ${email} ahora es administrador. Entra a /admin`);
      return;
    }
    if (data.users.length < 200) break;
  }
  throw new Error(`No existe un usuario con el correo ${email}. Regístrate primero en /registro.`);
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
