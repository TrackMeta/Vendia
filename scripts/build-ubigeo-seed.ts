/**
 * Genera supabase/migrations/20261008000500_ubigeo_seed.sql a partir de data/ubigeo/*.csv
 * Uso: npm run ubigeo:build
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildUbigeoDataset } from "../src/modules/ubigeo/parse";

const root = join(__dirname, "..");
const dataset = buildUbigeoDataset(
  readFileSync(join(root, "data/ubigeo/inei-2022-1891-distritos.csv"), "utf8"),
  readFileSync(join(root, "data/ubigeo/provisional.csv"), "utf8"),
);

const q = (value: string) => `'${value.replace(/'/g, "''")}'`;

const sql = `-- =====================================================================
-- Vendia — Ubigeo del Perú (INEI 2022, 1,891 distritos + provisionales)
-- GENERADO por scripts/build-ubigeo-seed.ts — no editar a mano.
-- Departamentos: ${dataset.departments.length} · Provincias: ${dataset.provinces.length} · Distritos: ${dataset.districts.length}
-- =====================================================================

insert into public.ubigeo_departments (code, name) values
${dataset.departments.map((d) => `  (${q(d.code)}, ${q(d.name)})`).join(",\n")}
on conflict (code) do update set name = excluded.name;

insert into public.ubigeo_provinces (code, department_code, name) values
${dataset.provinces.map((p) => `  (${q(p.code)}, ${q(p.departmentCode)}, ${q(p.name)})`).join(",\n")}
on conflict (code) do update set name = excluded.name, department_code = excluded.department_code;

insert into public.ubigeo_districts (code, province_code, name, is_provisional) values
${dataset.districts.map((d) => `  (${q(d.code)}, ${q(d.provinceCode)}, ${q(d.name)}, ${d.isProvisional})`).join(",\n")}
on conflict (code) do update set
  name = excluded.name, province_code = excluded.province_code, is_provisional = excluded.is_provisional;
`;

const out = join(root, "supabase/migrations/20261008000500_ubigeo_seed.sql");
writeFileSync(out, sql);
console.log(
  `OK → ${out}\n${dataset.departments.length} departamentos, ${dataset.provinces.length} provincias, ${dataset.districts.length} distritos`,
);
