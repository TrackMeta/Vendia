import { toDisplayName } from "./names";

export type UbigeoDataset = {
  departments: { code: string; name: string }[];
  provinces: { code: string; departmentCode: string; name: string }[];
  districts: { code: string; provinceCode: string; name: string; isProvisional: boolean }[];
};

type Row = { code: string; department: string; province: string; district: string };

function parseRows(csv: string): Row[] {
  return csv
    .split(/\r?\n/)
    .slice(1)
    .filter((line) => /^\d{6};/.test(line))
    .map((line) => {
      const [code, department, province, district] = line.split(";");
      return { code, department, province, district };
    });
}

/** Construye departamentos/provincias/distritos a partir del CSV del INEI (+ provisionales). */
export function buildUbigeoDataset(ineiCsv: string, provisionalCsv = ""): UbigeoDataset {
  const official = parseRows(ineiCsv);
  const provisional = parseRows(provisionalCsv);

  const departments = new Map<string, string>();
  const provinces = new Map<string, { departmentCode: string; name: string }>();
  const districts = new Map<string, { provinceCode: string; name: string; isProvisional: boolean }>();

  for (const [rows, isProvisional] of [
    [official, false],
    [provisional, true],
  ] as const) {
    for (const row of rows) {
      const departmentCode = row.code.slice(0, 2);
      const provinceCode = row.code.slice(0, 4);

      if (isProvisional && !provinces.has(provinceCode)) {
        throw new Error(`Distrito provisional ${row.code} apunta a una provincia inexistente`);
      }
      if (districts.has(row.code)) {
        throw new Error(`Código de distrito duplicado: ${row.code}`);
      }

      departments.set(departmentCode, departments.get(departmentCode) ?? toDisplayName(row.department));
      if (!provinces.has(provinceCode)) {
        provinces.set(provinceCode, { departmentCode, name: toDisplayName(row.province) });
      }
      districts.set(row.code, { provinceCode, name: toDisplayName(row.district), isProvisional });
    }
  }

  return {
    departments: [...departments].map(([code, name]) => ({ code, name })).sort((a, b) => a.code.localeCompare(b.code)),
    provinces: [...provinces]
      .map(([code, p]) => ({ code, ...p }))
      .sort((a, b) => a.code.localeCompare(b.code)),
    districts: [...districts]
      .map(([code, d]) => ({ code, ...d }))
      .sort((a, b) => a.code.localeCompare(b.code)),
  };
}
