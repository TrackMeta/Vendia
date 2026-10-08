/**
 * Módulos por país: moneda, teléfono, impuestos, zonas de envío, ubicaciones y couriers.
 * El país vive en la tienda (stores.country). Perú es el primero; para sumar otro país
 * se agrega una entrada en COUNTRIES (y su archivo de ubicaciones y couriers).
 */
export type Zone = "lima" | "provincia";

export type CountryConfig = {
  code: string;
  name: string;
  currency: string;
  /** Prefijo internacional sin «+» */
  phonePrefix: string;
  /** Dígitos del celular sin prefijo */
  phoneLength: number;
  /** Primer dígito de un celular */
  mobileStart: string;
  tax: { name: string; rate: number };
  /** Zona de envío según el código de provincia */
  zoneOf: (provinceCode: string | null | undefined) => Zone;
  zoneLabels: Record<Zone, string>;
  /** Archivo público con departamentos, provincias y distritos */
  locationsUrl: string;
  /** Couriers del catálogo disponibles en el país */
  couriers: string[];
  timeZone: string;
  available: boolean;
};

const PE: CountryConfig = {
  code: "PE",
  name: "Perú",
  currency: "PEN",
  phonePrefix: "51",
  phoneLength: 9,
  mobileStart: "9",
  tax: { name: "IGV", rate: 0.18 },
  // Lima Metropolitana (1501) y Callao (0701) son «Lima»; el resto, provincia
  zoneOf: (provinceCode) => (provinceCode === "1501" || provinceCode === "0701" ? "lima" : "provincia"),
  zoneLabels: { lima: "Lima", provincia: "Provincia" },
  locationsUrl: "/ubigeo-pe.json",
  couriers: ["eva", "shalom", "olva"],
  timeZone: "America/Lima",
  available: true,
};

export const COUNTRIES: Record<string, CountryConfig> = { PE };

/** Países que se muestran como «próximamente» al crear una tienda. */
export const UPCOMING_COUNTRIES = ["Colombia", "Ecuador", "Chile", "México", "Bolivia"];

export const DEFAULT_COUNTRY = PE;

export function getCountry(code: string | null | undefined): CountryConfig {
  return (code && COUNTRIES[code.toUpperCase()]) || DEFAULT_COUNTRY;
}

/** Celular → formato internacional sin «+» (51XXXXXXXXX en Perú). Null si no es válido. */
export function normalizePhone(raw: string, country: CountryConfig = DEFAULT_COUNTRY): string | null {
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith(`00${country.phonePrefix}`)) digits = digits.slice(2);
  if (digits.length === country.phoneLength && digits.startsWith(country.mobileStart)) return `${country.phonePrefix}${digits}`;
  if (digits.length === country.phonePrefix.length + country.phoneLength && digits.startsWith(`${country.phonePrefix}${country.mobileStart}`)) return digits;
  return null;
}

/** 51987654321 → 987 654 321 */
export function displayPhone(phone: string, country: CountryConfig = DEFAULT_COUNTRY): string {
  const local = phone.startsWith(country.phonePrefix) ? phone.slice(country.phonePrefix.length) : phone;
  return local.replace(/(\d{3})(\d{3})(\d{3})/, "$1 $2 $3");
}
