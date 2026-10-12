import { displayPeruPhone, normalizePeruPhone } from "@/lib/format";

/** Dígitos máximos que se dejan escribir: 9 del celular + 2 del código de país (51). */
const MAX_DIGITS = 11;

/**
 * Limpia lo que el cliente escribe o pega en «Celular».
 * Si pega el número con código de país (+51 987 654 321, 0051…, 51987654321) se queda
 * con los 9 dígitos del celular. Si no, deja solo números y espacios, hasta 11 dígitos.
 */
export function cleanPhoneInput(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length > 9) {
    const normalized = normalizePeruPhone(raw);
    if (normalized) return displayPeruPhone(normalized);
  }
  let out = "";
  let count = 0;
  for (const ch of raw.replace(/[^\d ]/g, "").replace(/ {2,}/g, " ").trimStart()) {
    if (ch === " ") {
      out += ch;
      continue;
    }
    if (count >= MAX_DIGITS) break;
    out += ch;
    count++;
  }
  return out;
}
