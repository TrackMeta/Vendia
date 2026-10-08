import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeForSearch, toDisplayName } from "./names";
import { buildUbigeoDataset } from "./parse";

const root = join(__dirname, "../../..");
const dataset = buildUbigeoDataset(
  readFileSync(join(root, "data/ubigeo/inei-2022-1891-distritos.csv"), "utf8"),
  readFileSync(join(root, "data/ubigeo/provisional.csv"), "utf8"),
);

describe("Ubigeo del Perú (INEI)", () => {
  it("tiene los conteos oficiales: 25 departamentos, 196 provincias, 1891 + 2 distritos", () => {
    expect(dataset.departments).toHaveLength(25);
    expect(dataset.provinces).toHaveLength(196);
    expect(dataset.districts).toHaveLength(1893);
    expect(dataset.districts.filter((d) => d.isProvisional)).toHaveLength(2);
  });

  it("no tiene códigos duplicados", () => {
    expect(new Set(dataset.districts.map((d) => d.code)).size).toBe(dataset.districts.length);
    expect(new Set(dataset.provinces.map((p) => p.code)).size).toBe(dataset.provinces.length);
  });

  it("cada distrito pertenece a una provincia existente y cada provincia a un departamento", () => {
    const provinces = new Set(dataset.provinces.map((p) => p.code));
    const departments = new Set(dataset.departments.map((d) => d.code));
    for (const d of dataset.districts) {
      expect(provinces.has(d.provinceCode)).toBe(true);
      expect(d.code.startsWith(d.provinceCode)).toBe(true);
    }
    for (const p of dataset.provinces) {
      expect(departments.has(p.departmentCode)).toBe(true);
    }
  });

  it("cada provincia tiene su distrito capital terminado en 01", () => {
    const codes = new Set(dataset.districts.map((d) => d.code));
    for (const p of dataset.provinces) expect(codes.has(`${p.code}01`)).toBe(true);
  });

  it("Lima → Lima → San Juan de Miraflores existe con código INEI 150133", () => {
    const district = dataset.districts.find((d) => d.code === "150133");
    expect(district?.name).toBe("San Juan de Miraflores");
    expect(dataset.provinces.find((p) => p.code === "1501")?.name).toBe("Lima");
    expect(dataset.departments.find((d) => d.code === "15")?.name).toBe("Lima");
  });

  it("Callao usa el código INEI 07 (no el de RENIEC)", () => {
    expect(dataset.departments.find((d) => d.code === "07")?.name).toBe("Callao");
  });

  it("rechaza un distrito provisional en una provincia inexistente", () => {
    const header = "IDDIST;NOMBDEP;NOMBPROV;NOMBDIST\n";
    expect(() => buildUbigeoDataset(`${header}010101;A;B;C`, `${header}999901;X;Y;Z`)).toThrow();
  });
});

describe("Nombres", () => {
  it("formatea nombres en mayúsculas", () => {
    expect(toDisplayName("SAN JUAN DE LURIGANCHO")).toBe("San Juan de Lurigancho");
    expect(toDisplayName("CARMEN DE LA LEGUA REYNOSO")).toBe("Carmen de la Legua Reynoso");
    expect(toDisplayName("NEPEÑA")).toBe("Nepeña");
  });

  it("normaliza para búsqueda sin tildes", () => {
    expect(normalizeForSearch("  Ancón ")).toBe("ancon");
  });
});
