import { describe, expect, it } from "vitest";
import { parseCsv, toCsv } from "./csv";
import { parseAmount, parseDate, parseMetaAdsCsv } from "./import-meta";

describe("CSV", () => {
  it("parsea comillas, comas internas y punto y coma", () => {
    expect(parseCsv('a,b\n"x, y","z ""q"""')).toEqual([
      ["a", "b"],
      ["x, y", 'z "q"'],
    ]);
    expect(parseCsv("a;b\n1;2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("genera CSV con BOM y protege contra fórmulas de Excel", () => {
    const csv = toCsv([["Nombre", "Nota"], ["Ana", "=HYPERLINK()"]]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain("'=HYPERLINK()");
  });
});

describe("Importar gasto de Meta Ads", () => {
  it("lee un reporte en español con desglose por día y campaña", () => {
    const csv = [
      "Inicio del informe,Fin del informe,Día,Nombre de la campaña,Identificador de la campaña,Importe gastado (PEN)",
      "2026-10-01,2026-10-02,2026-10-01,Faja Octubre,120200111,150.50",
      "2026-10-01,2026-10-02,2026-10-02,Faja Octubre,120200111,99.5",
      "2026-10-01,2026-10-02,2026-10-01,Biocapilar,120200222,0",
      "2026-10-01,2026-10-02,,,,250",
    ].join("\n");
    const result = parseMetaAdsCsv(csv);
    expect(result.errors).toEqual([]);
    expect(result.rows).toEqual([
      { date: "2026-10-01", campaignId: "120200111", campaignName: "Faja Octubre", amount: 150.5, importKey: "meta:2026-10-01:120200111" },
      { date: "2026-10-02", campaignId: "120200111", campaignName: "Faja Octubre", amount: 99.5, importKey: "meta:2026-10-02:120200111" },
    ]);
  });

  it("lee un reporte en inglés sin desglose diario (avisa)", () => {
    const csv = 'Reporting starts,Reporting ends,Campaign name,Amount spent (PEN)\n2026-10-01,2026-10-07,"Promo, Lima",1234.56';
    const result = parseMetaAdsCsv(csv);
    expect(result.rows[0]).toMatchObject({ date: "2026-10-01", campaignId: null, campaignName: "Promo, Lima", amount: 1234.56 });
    expect(result.warnings.length).toBe(2);
  });

  it("rechaza archivos sin la columna de gasto", () => {
    expect(parseMetaAdsCsv("Día,Campaña\n2026-10-01,X").errors.length).toBeGreaterThan(0);
  });

  it("interpreta montos y fechas en formatos comunes", () => {
    expect(parseAmount("1,234.56")).toBe(1234.56);
    expect(parseAmount("1.234,56")).toBe(1234.56);
    expect(parseAmount("S/ 99")).toBe(99);
    expect(parseDate("05/10/2026")).toBe("2026-10-05");
    expect(parseDate("2026-10-05")).toBe("2026-10-05");
    expect(parseDate("31/13/2026")).toBeNull();
  });
});
