import "server-only";
import { createSign } from "node:crypto";

/**
 * Envío de avisos a la app de celular con Firebase Cloud Messaging (API HTTP v1).
 * Usa la cuenta de servicio de Firebase (JSON) guardada en la variable de entorno
 * FCM_SERVICE_ACCOUNT de Vercel. Sin ella no se manda nada.
 */
type ServiceAccount = { client_email: string; private_key: string; project_id: string };

export type PushMessage = {
  title: string;
  body: string;
  channel: string;
  tag?: string;
  /** Número en el ícono de la app (pedidos por confirmar). */
  count?: number;
  /** Solo texto (lo exige Firebase). */
  data?: Record<string, string>;
};

export type PushResult = "ok" | "invalid" | "error";

/**
 * La cuenta de servicio, o por qué no sirve (sin revelar su contenido):
 * «sin_firebase» = falta la variable; «firebase_no_es_json» = el texto está cortado o incompleto;
 * «firebase_otro_archivo» = es otro JSON (p. ej. google-services.json, que es para la app, no para el servidor).
 */
export function serviceAccountStatus(): ServiceAccount | "sin_firebase" | "firebase_no_es_json" | "firebase_otro_archivo" {
  const raw = process.env.FCM_SERVICE_ACCOUNT?.trim();
  if (!raw) return "sin_firebase";
  let sa: Partial<ServiceAccount>;
  try {
    sa = JSON.parse(raw) as Partial<ServiceAccount>;
  } catch {
    return "firebase_no_es_json";
  }
  return sa.client_email && sa.private_key && sa.project_id ? (sa as ServiceAccount) : "firebase_otro_archivo";
}

const b64url = (input: string | Buffer) => Buffer.from(input).toString("base64url");

let cached: { token: string; exp: number; email: string } | null = null;

/** Token de acceso de Google (dura 1 hora; se reutiliza mientras sirva). */
async function accessToken(sa: ServiceAccount): Promise<string> {
  if (cached && cached.email === sa.client_email && cached.exp > Date.now() + 60_000) return cached.token;
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  );
  const signature = createSign("RSA-SHA256").update(`${head}.${claims}`).sign(sa.private_key.replace(/\\n/g, "\n"));
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${head}.${claims}.${b64url(signature)}` }),
  });
  const json = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new Error(`Google no dio acceso a Firebase (${res.status})`);
  cached = { token: json.access_token, exp: Date.now() + (Number(json.expires_in) || 3600) * 1000, email: sa.client_email };
  return json.access_token;
}

/** Manda un aviso a un celular. «invalid» = la app se desinstaló o el token venció (hay que borrarlo). */
export async function sendPush(sa: ServiceAccount, token: string, msg: PushMessage): Promise<PushResult> {
  const at = await accessToken(sa);
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${at}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: {
        token,
        notification: { title: msg.title.slice(0, 120), body: msg.body.slice(0, 240) },
        data: msg.data ?? {},
        android: {
          priority: "HIGH",
          ttl: "86400s",
          notification: {
            channel_id: msg.channel,
            tag: msg.tag,
            notification_count: msg.count,
            icon: "ic_stat_vendia",
            color: "#E53935",
            default_vibrate_timings: true,
            notification_priority: "PRIORITY_MAX",
            visibility: "PRIVATE",
          },
        },
      },
    }),
  });
  if (res.ok) return "ok";
  const text = await res.text().catch(() => "");
  if (res.status === 404 || /UNREGISTERED|registration-token-not-registered/i.test(text)) return "invalid";
  if (res.status === 400 && /token/i.test(text) && /INVALID_ARGUMENT/.test(text)) return "invalid";
  console.warn("[push] FCM", res.status, text.slice(0, 300));
  return "error";
}
