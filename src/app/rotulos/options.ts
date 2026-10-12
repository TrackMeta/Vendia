/** Cookie con lo que se muestra en los rótulos de provincia (se recuerda para la próxima vez). */
export const LABEL_COOKIE = "vd_rotulo_prov";
export type LabelOptions = { logo: boolean; saldo: boolean };

export function parseLabelOptions(value: string | undefined): LabelOptions {
  const off = new Set((value ?? "").split(","));
  return { logo: !off.has("sin-logo"), saldo: !off.has("sin-saldo") };
}

export function serializeLabelOptions(o: LabelOptions) {
  return [o.logo ? null : "sin-logo", o.saldo ? null : "sin-saldo"].filter(Boolean).join(",");
}
