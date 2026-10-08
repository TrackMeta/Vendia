import "server-only";
import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

/**
 * Cliente con la clave secreta: IGNORA RLS.
 * Usar solo en el servidor y solo para operaciones acotadas
 * (crear pedidos públicos vía create_cod_order, tareas del sistema).
 */
export function createAdminClient() {
  return createClient(env.supabaseUrl(), env.supabaseSecretKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
