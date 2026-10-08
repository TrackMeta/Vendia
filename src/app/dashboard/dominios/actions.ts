"use server";

import { resolve4, resolveCname } from "node:dns/promises";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOwner } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { dnsInstructions, isValidDomain, normalizeDomain, VERCEL_A_RECORD, VERCEL_CNAME } from "@/modules/domains";

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

/**
 * Vercel: si están VERCEL_TOKEN y VERCEL_PROJECT_ID, el dominio se agrega solo al proyecto.
 * Si no, el dueño lo agrega a mano en Vercel → Settings → Domains.
 */
async function vercel(method: "POST" | "DELETE", domain: string): Promise<string | null> {
  const token = process.env.VERCEL_TOKEN;
  const project = process.env.VERCEL_PROJECT_ID;
  if (!token || !project) return null;
  const team = process.env.VERCEL_TEAM_ID ? `?teamId=${process.env.VERCEL_TEAM_ID}` : "";
  const url =
    method === "POST"
      ? `https://api.vercel.com/v10/projects/${project}/domains${team}`
      : `https://api.vercel.com/v9/projects/${project}/domains/${domain}${team}`;
  try {
    const res = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: method === "POST" ? JSON.stringify({ name: domain }) : undefined,
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) return null;
    const json = (await res.json().catch(() => ({}))) as { error?: { message?: string; code?: string } };
    if (json.error?.code === "domain_already_in_use" || json.error?.code === "domain_already_exists") return null;
    return json.error?.message ?? `Vercel respondió ${res.status}`;
  } catch {
    return "No se pudo conectar con Vercel";
  }
}

export async function addDomain(input: { domain: string; scope: "store" | "all" }): Promise<ActionResult> {
  const { user, store } = await requireOwner();
  const parsed = z.object({ domain: z.string().max(260), scope: z.enum(["store", "all"]) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Datos inválidos" };
  const domain = normalizeDomain(parsed.data.domain);
  if (!isValidDomain(domain)) return { ok: false, error: "Escribe un dominio válido, por ejemplo tienda.midominio.pe" };
  const app = process.env.NEXT_PUBLIC_SITE_URL ? new URL(process.env.NEXT_PUBLIC_SITE_URL).hostname : "";
  if (domain === app || domain.endsWith(".vercel.app")) return { ok: false, error: "Ese dominio no se puede usar" };

  const supabase = await createClient();
  const { error } = await supabase.from("custom_domains").insert({ domain, owner_id: user.id, store_id: parsed.data.scope === "store" ? store.id : null });
  if (error) return { ok: false, error: error.code === "23505" ? "Ese dominio ya está registrado en Vendia" : "No se pudo agregar el dominio" };

  const vercelError = await vercel("POST", domain);
  revalidatePath("/dashboard/dominios");
  return vercelError
    ? { ok: true, message: `Dominio agregado. Vercel avisó: ${vercelError}. Agrégalo también en Vercel → Settings → Domains.` }
    : { ok: true, message: "Dominio agregado. Ahora crea el registro DNS y toca «Verificar»." };
}

/** Revisa el DNS: si ya apunta a Vercel, el dominio queda activo. */
export async function verifyDomain(id: string): Promise<ActionResult> {
  const { user } = await requireOwner();
  if (!z.uuid().safeParse(id).success) return { ok: false, error: "Dominio inválido" };
  const supabase = await createClient();
  const { data: row } = await supabase.from("custom_domains").select("id, domain").eq("id", id).eq("owner_id", user.id).maybeSingle();
  if (!row) return { ok: false, error: "Dominio no encontrado" };

  const expected = dnsInstructions(row.domain);
  let ok = false;
  let found = "";
  try {
    if (expected.type === "A") {
      const ips = await resolve4(row.domain);
      found = ips.join(", ");
      ok = ips.includes(VERCEL_A_RECORD);
    } else {
      const names = await resolveCname(row.domain);
      found = names.join(", ");
      ok = names.some((n) => n.toLowerCase().replace(/\.$/, "").endsWith("vercel-dns.com"));
    }
  } catch {
    found = "sin registro";
  }

  const admin = createAdminClient();
  await admin
    .from("custom_domains")
    .update({
      status: ok ? "active" : "pending",
      last_check_at: new Date().toISOString(),
      last_error: ok ? null : `El DNS aún no apunta a Vercel (encontrado: ${found || "nada"}). Puede tardar hasta 24 h.`.slice(0, 500),
    })
    .eq("id", row.id);
  revalidatePath("/dashboard/dominios");
  return ok
    ? { ok: true, message: `¡${row.domain} está activo! Tus landings ya se ven en ese dominio.` }
    : { ok: false, error: `Todavía no: el registro ${expected.type} debe apuntar a ${expected.type === "A" ? VERCEL_A_RECORD : VERCEL_CNAME}. Encontrado: ${found || "nada"}.` };
}

export async function deleteDomain(id: string): Promise<ActionResult> {
  const { user } = await requireOwner();
  if (!z.uuid().safeParse(id).success) return { ok: false, error: "Dominio inválido" };
  const supabase = await createClient();
  const { data } = await supabase.from("custom_domains").delete().eq("id", id).eq("owner_id", user.id).select("domain");
  if (!data?.length) return { ok: false, error: "No se pudo eliminar" };
  await vercel("DELETE", data[0].domain);
  revalidatePath("/dashboard/dominios");
  return { ok: true, message: "Dominio eliminado" };
}
