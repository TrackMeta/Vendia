import "server-only";

/**
 * Conexión con Vercel para los dominios propios.
 * Necesita VERCEL_TOKEN y VERCEL_PROJECT_ID (y VERCEL_TEAM_ID si el proyecto es de un equipo).
 * Sin ellas, los dominios se guardan como pendientes pero no se pueden activar.
 */

const TIMEOUT_MS = 8000;

export type VercelResult = { ok: true } | { ok: false; error: string };

type VercelError = { error?: { code?: string; message?: string } };
type ProjectDomain = { name: string; verified?: boolean; verification?: { type: string; domain: string; value: string }[] };

export function vercelConnected(): boolean {
  return Boolean(process.env.VERCEL_TOKEN && process.env.VERCEL_PROJECT_ID);
}

export const NOT_CONNECTED = "Falta que el administrador de Vendia conecte Vercel. Hasta entonces el dominio no se puede activar.";

async function call(method: "GET" | "POST" | "DELETE", path: string, body?: unknown): Promise<Response> {
  const team = process.env.VERCEL_TEAM_ID ? `?teamId=${encodeURIComponent(process.env.VERCEL_TEAM_ID)}` : "";
  return fetch(`https://api.vercel.com${path}${team}`, {
    method,
    headers: { Authorization: `Bearer ${process.env.VERCEL_TOKEN}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
}

const project = () => encodeURIComponent(process.env.VERCEL_PROJECT_ID ?? "");

async function getProjectDomain(domain: string): Promise<ProjectDomain | null> {
  const res = await call("GET", `/v9/projects/${project()}/domains/${encodeURIComponent(domain)}`);
  return res.ok ? ((await res.json()) as ProjectDomain) : null;
}

/** Agrega el dominio al proyecto de Vendia (si ya estaba en este proyecto, está bien). */
export async function addVercelDomain(domain: string, redirectTo?: string): Promise<VercelResult> {
  if (!vercelConnected()) return { ok: false, error: NOT_CONNECTED };
  try {
    const res = await call("POST", `/v10/projects/${project()}/domains`, redirectTo ? { name: domain, redirect: redirectTo, redirectStatusCode: 308 } : { name: domain });
    if (res.ok) return { ok: true };
    const json = (await res.json().catch(() => ({}))) as VercelError;
    const code = json.error?.code;
    if (code === "domain_already_exists") return { ok: true };
    if (code === "domain_already_in_use") {
      // Puede estar ya en este mismo proyecto: se confirma antes de rechazarlo
      if (await getProjectDomain(domain)) return { ok: true };
      return { ok: false, error: `${domain} está conectado a otra cuenta o proyecto de Vercel. Quítalo de allí primero o escríbenos.` };
    }
    return { ok: false, error: `Vercel no aceptó el dominio: ${json.error?.message ?? `respondió ${res.status}`}` };
  } catch {
    return { ok: false, error: "No se pudo conectar con Vercel. Intenta de nuevo en unos minutos." };
  }
}

/** Quita el dominio del proyecto (si no estaba, está bien). */
export async function removeVercelDomain(domain: string): Promise<VercelResult> {
  if (!vercelConnected()) return { ok: true };
  try {
    const res = await call("DELETE", `/v9/projects/${project()}/domains/${encodeURIComponent(domain)}`);
    if (res.ok || res.status === 404) return { ok: true };
    const json = (await res.json().catch(() => ({}))) as VercelError;
    return { ok: false, error: `No se pudo quitar ${domain} de Vercel: ${json.error?.message ?? `respondió ${res.status}`}. Intenta de nuevo.` };
  } catch {
    return { ok: false, error: "No se pudo conectar con Vercel. Intenta de nuevo en unos minutos." };
  }
}

/**
 * ¿Vercel ya puede servir el dominio?
 *  1. Debe estar verificado en el proyecto (si otra cuenta de Vercel lo usó, pide un TXT _vercel).
 *  2. Su DNS debe estar bien configurado (misconfigured = false).
 */
export async function checkVercelDomain(domain: string): Promise<VercelResult> {
  if (!vercelConnected()) return { ok: false, error: NOT_CONNECTED };
  try {
    let info = await getProjectDomain(domain);
    if (!info) return { ok: false, error: "El dominio aún no está en Vercel. Toca «Verificar» de nuevo en unos minutos." };
    if (info.verified === false) {
      const res = await call("POST", `/v9/projects/${project()}/domains/${encodeURIComponent(domain)}/verify`);
      if (res.ok) info = (await res.json()) as ProjectDomain;
      if (info.verified === false) {
        const txt = info.verification?.find((v) => v.type.toUpperCase() === "TXT");
        return {
          ok: false,
          error: txt
            ? `Vercel pide un registro más: TXT ${txt.domain} = ${txt.value}`
            : "Vercel todavía no verifica el dominio. Si no se activa en 24 h, escríbenos.",
        };
      }
    }
    const res = await call("GET", `/v6/domains/${encodeURIComponent(domain)}/config`);
    if (!res.ok) return { ok: false, error: `Vercel no pudo revisar el dominio (respondió ${res.status}). Intenta más tarde.` };
    const config = (await res.json()) as { misconfigured?: boolean };
    if (config.misconfigured !== false) return { ok: false, error: "Vercel todavía ve el DNS mal configurado. Los cambios pueden tardar unas horas." };
    return { ok: true };
  } catch {
    return { ok: false, error: "No se pudo conectar con Vercel. Intenta de nuevo en unos minutos." };
  }
}
