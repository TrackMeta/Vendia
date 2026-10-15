"use server";

import { resolve4, resolve6, resolveCname, resolveTxt } from "node:dns/promises";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOwner } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { checkDns, hasVerifyTxt, isValidDomain, normalizeDomain, recordName, verifyHost, verifyValue, wwwCompanion } from "@/modules/domains";
import { addVercelDomain, checkVercelDomain, NOT_CONNECTED, removeVercelDomain, vercelConnected } from "@/modules/domains/vercel";

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

/** Sin registro (o error de DNS) → lista vacía. */
const lookup = <T>(p: Promise<T[]>) => p.catch(() => [] as T[]);

/** www.tienda.pe lleva a tienda.pe (solo si nadie agregó www.tienda.pe como dominio propio). */
async function addWwwRedirect(domain: string) {
  const www = wwwCompanion(domain);
  if (!www) return;
  const { data } = await createAdminClient().from("custom_domains").select("id").eq("domain", www).maybeSingle();
  if (!data) await addVercelDomain(www, domain);
}

export async function addDomain(input: { domain: string; scope: "store" | "all" }): Promise<ActionResult> {
  const { user, store } = await requireOwner();
  const parsed = z.object({ domain: z.string().max(260), scope: z.enum(["store", "all"]) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Datos inválidos" };
  const domain = normalizeDomain(parsed.data.domain);
  if (!isValidDomain(domain)) return { ok: false, error: "Escribe un dominio válido, por ejemplo tienda.midominio.pe" };
  const app = process.env.NEXT_PUBLIC_SITE_URL ? new URL(process.env.NEXT_PUBLIC_SITE_URL).hostname : "";
  if (domain === app || domain.endsWith(`.${app}`) || domain.endsWith(".vercel.app")) return { ok: false, error: "Ese dominio no se puede usar" };

  const supabase = await createClient();
  const { data: row, error } = await supabase
    .from("custom_domains")
    .insert({ domain, owner_id: user.id, store_id: parsed.data.scope === "store" ? store.id : null })
    .select("id")
    .single();
  if (error || !row) return { ok: false, error: error?.code === "23505" ? "Ese dominio ya está registrado en Vendia" : "No se pudo agregar el dominio" };

  revalidatePath("/dashboard/dominios");
  if (!vercelConnected()) {
    return { ok: true, message: `Dominio guardado como pendiente. ${NOT_CONNECTED} Puedes crear los registros DNS desde ya.` };
  }
  const added = await addVercelDomain(domain);
  if (!added.ok) {
    // No se pudo agregar a Vercel: no se guarda (el vendedor puede intentarlo de nuevo)
    await supabase.from("custom_domains").delete().eq("id", row.id);
    return { ok: false, error: added.error };
  }
  await addWwwRedirect(domain);
  return { ok: true, message: "Dominio agregado. Ahora crea los registros DNS y toca «Verificar»." };
}

/**
 * Activa el dominio solo si:
 *  1. El TXT _vendia.<dominio> tiene el código de este dominio (prueba que es del vendedor).
 *  2. El DNS apunta a Vercel.
 *  3. Vercel está conectado y ve el dominio bien configurado.
 * El estado lo escribe el servidor (el vendedor no tiene permiso para cambiarlo).
 */
export async function verifyDomain(id: string): Promise<ActionResult> {
  const { user } = await requireOwner();
  if (!z.uuid().safeParse(id).success) return { ok: false, error: "Dominio inválido" };
  const supabase = await createClient();
  const { data: row } = await supabase.from("custom_domains").select("id, domain, status, verify_token").eq("id", id).eq("owner_id", user.id).maybeSingle();
  if (!row) return { ok: false, error: "Dominio no encontrado" };

  const [txt, cname, a, aaaa] = await Promise.all([
    lookup(resolveTxt(verifyHost(row.domain))),
    lookup(resolveCname(row.domain)),
    lookup(resolve4(row.domain)),
    lookup(resolve6(row.domain)),
  ]);

  let error: string | null = null;
  if (!hasVerifyTxt(txt, row.verify_token)) {
    error = `Falta el registro TXT «${recordName(verifyHost(row.domain))}» con el valor ${verifyValue(row.verify_token)}. Puede tardar unas horas.`;
  } else {
    const dns = checkDns(row.domain, { cname, a, aaaa });
    if (!dns.ok) error = `${dns.error} Puede tardar unas horas.`;
    else if (!vercelConnected()) error = `Tu DNS está bien. ${NOT_CONNECTED}`;
    else {
      // Por si se agregó cuando Vercel aún no estaba conectado
      const added = await addVercelDomain(row.domain);
      if (!added.ok) error = added.error;
      else {
        await addWwwRedirect(row.domain);
        const vercel = await checkVercelDomain(row.domain);
        if (!vercel.ok) error = vercel.error;
      }
    }
  }

  // Un dominio ya activo no se desactiva por una revisión fallida (solo queda el aviso):
  // si volviera a «pendiente», la limpieza de 7 días lo borraría.
  const status = !error || row.status === "active" ? "active" : "pending";
  const admin = createAdminClient();
  await admin
    .from("custom_domains")
    .update({ status, last_check_at: new Date().toISOString(), last_error: error ? error.slice(0, 500) : null })
    .eq("id", row.id);
  revalidatePath("/dashboard/dominios");
  if (error && status === "active") return { ok: false, error: `${row.domain} sigue activo, pero revisa: ${error}` };
  return error ? { ok: false, error: `Todavía no: ${error}` } : { ok: true, message: `¡${row.domain} está activo! Tus landings ya se ven en ese dominio.` };
}

export async function deleteDomain(id: string): Promise<ActionResult> {
  const { user } = await requireOwner();
  if (!z.uuid().safeParse(id).success) return { ok: false, error: "Dominio inválido" };
  const supabase = await createClient();
  const { data: row } = await supabase.from("custom_domains").select("id, domain").eq("id", id).eq("owner_id", user.id).maybeSingle();
  if (!row) return { ok: false, error: "Dominio no encontrado" };

  // Primero se quita de Vercel: si falla, no se borra (así no queda un dominio suelto en Vercel)
  const removed = await removeVercelDomain(row.domain);
  if (!removed.ok) return { ok: false, error: removed.error };
  const www = wwwCompanion(row.domain);
  if (www) {
    const { data: own } = await createAdminClient().from("custom_domains").select("id").eq("domain", www).maybeSingle();
    if (!own) {
      const wwwRemoved = await removeVercelDomain(www);
      if (!wwwRemoved.ok) return { ok: false, error: wwwRemoved.error };
    }
  }

  const { data } = await supabase.from("custom_domains").delete().eq("id", row.id).eq("owner_id", user.id).select("id");
  if (!data?.length) return { ok: false, error: "No se pudo eliminar" };
  revalidatePath("/dashboard/dominios");
  return { ok: true, message: "Dominio eliminado" };
}
