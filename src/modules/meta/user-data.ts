import { createHash } from "node:crypto";

/**
 * Normalización y hashing de user_data según Meta Conversions API:
 * https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/customer-information-parameters
 * - SHA-256 obligatorio: ph, fn, ln, ct, st, country, external_id (recomendado).
 * - SIN hash: client_ip_address, client_user_agent, fbc, fbp.
 */

export function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** Teléfono: solo dígitos, con código de país, sin ceros iniciales (Perú: 51 + 9 dígitos). */
export function normalizePhone(phone: string): string | null {
  let digits = phone.replace(/\D/g, "").replace(/^0+/, "");
  if (digits.length === 9 && digits.startsWith("9")) digits = `51${digits}`;
  return digits.length >= 8 ? digits : null;
}

/** Nombres: minúsculas, sin puntuación, UTF-8 (se mantienen tildes y ñ). */
export function normalizeName(name: string): string | null {
  const v = name
    .trim()
    .toLowerCase()
    .replace(/[\p{P}\p{S}]/gu, "")
    .replace(/\s+/g, " ");
  return v || null;
}

/** Ciudad / región: minúsculas, sin espacios, sin puntuación ni tildes. */
export function normalizeLocation(value: string): string | null {
  const v = value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  return v || null;
}

export type CustomerInfo = {
  phone?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  city?: string | null;
  region?: string | null;
  externalId?: string | null;
  clientIp?: string | null;
  userAgent?: string | null;
  fbc?: string | null;
  fbp?: string | null;
};

export type MetaUserData = {
  ph?: string[];
  fn?: string[];
  ln?: string[];
  ct?: string[];
  st?: string[];
  country?: string[];
  external_id?: string[];
  client_ip_address?: string;
  client_user_agent?: string;
  fbc?: string;
  fbp?: string;
};

const hashed = (value: string | null | undefined): string[] | undefined => (value ? [sha256(value)] : undefined);

export function buildUserData(info: CustomerInfo): MetaUserData {
  const data: MetaUserData = {
    ph: hashed(info.phone ? normalizePhone(info.phone) : null),
    fn: hashed(info.firstName ? normalizeName(info.firstName) : null),
    ln: hashed(info.lastName ? normalizeName(info.lastName) : null),
    ct: hashed(info.city ? normalizeLocation(info.city) : null),
    st: hashed(info.region ? normalizeLocation(info.region) : null),
    country: hashed("pe"),
    external_id: hashed(info.externalId ?? null),
    client_ip_address: info.clientIp ?? undefined,
    client_user_agent: info.userAgent ?? undefined,
    fbc: info.fbc ?? undefined,
    fbp: info.fbp ?? undefined,
  };
  return Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)) as MetaUserData;
}
