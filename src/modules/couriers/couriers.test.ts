import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildCourierFile, evaDistrict, reviewExport, suggestAgency, toCourierOrder, type CourierOrder } from "./index";
import { entryByName, entryText, readZip } from "./xlsx-fill";

const template = (file: string) => {
  const b = readFileSync(join(process.cwd(), "public/couriers", file));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

describe("Sugerencia de agencia Shalom", () => {
  it("encuentra la agencia exacta o la contenida en el texto", () => {
    expect(suggestAgency("Abancay")).toBe("ABANCAY");
    expect(suggestAgency("abancay apurimac")).toBe("ABANCAY");
  });
  it("no adivina cuando es ambiguo", () => {
    expect(suggestAgency("Cusco")).toBe("");
    expect(suggestAgency("")).toBe("");
  });
});

describe("Distritos de Eva", () => {
  it("equivale por nombre sin tildes", () => {
    expect(evaDistrict("Breña")).toBe("BREÑA");
    expect(evaDistrict("Ate")).toBe("ATE");
    expect(evaDistrict("Arequipa")).toBe("");
  });
});

describe("Revisión previa", () => {
  it("Shalom exige DNI de 8 dígitos, agencia oficial y origen", () => {
    const warnings = reviewExport("shalom", [{ orderNumber: 7, customer: "Ana", phone: "51912345678", dni: "123", agency: "NO EXISTE" }], {});
    expect(warnings.join(" ")).toMatch(/ORIGEN/);
    expect(warnings.join(" ")).toMatch(/#7: el DNI/);
    expect(warnings.join(" ")).toMatch(/no es una agencia/);
  });
  it("Eva avisa distrito fuera de cobertura y enlaces de mapa", () => {
    const w = reviewExport("eva", [{ customer: "Luis", phone: "987654321", district: "Arequipa", address: "https://maps.app.goo.gl/x" }]);
    expect(w).toHaveLength(2);
  });
  it("Olva todavía no tiene plantilla", () => {
    expect(reviewExport("olva", [])[0]).toMatch(/todavía no/);
  });
});

describe("Excel con la plantilla oficial", () => {
  it("Shalom: DNI como texto, medidas en 0 y origen", async () => {
    const orders: CourierOrder[] = [
      { customer: "Pedro", phone: "51912345678", dni: "01234567", city: "Abancay" },
      { customer: "Luz", phone: "956789123", dni: "45678912", agency: "ANDAHUAYLAS", packageSize: "PAQUETE M", weight: 2 },
    ];
    const out = await buildCourierFile("shalom", orders, template("shalom.xlsx"), { originAgency: "ATOCONGO" });
    expect(out.rows).toBe(2);
    expect(out.fileName).toMatch(/^Shalom_por_enviar_\d{4}-\d{2}-\d{2}\.xlsx$/);
    const entries = readZip(out.bytes.buffer as ArrayBuffer);
    const xml = await entryText(entryByName(entries, "xl/worksheets/sheet1.xml")!);
    expect(xml).toContain('<c r="A2" t="inlineStr"><is><t xml:space="preserve">01234567</t></is></c>');
    expect(xml).toContain(">ABANCAY<");
    expect(xml).toContain(">ATOCONGO<");
    expect(xml).toContain('<c r="I2"><v>0</v></c>');
    expect(xml).toContain('<c r="L3"><v>2</v></c>');
    expect(xml).not.toContain('r="4"');
  });

  it("Eva: cobra el saldo, ajusta la tabla y escapa caracteres", async () => {
    const orders: CourierOrder[] = [
      { customer: "Ana & <Ríos>", phone: "+51 987 654 321", district: "Miraflores", address: "Av. Larco 123\u0001", reference: "Parque", amountToCollect: 69.9, description: "Faja", quantity: 1 },
    ];
    const out = await buildCourierFile("eva", orders, template("eva.xlsm"));
    const entries = readZip(out.bytes.buffer as ArrayBuffer);
    const xml = await entryText(entryByName(entries, "xl/worksheets/sheet2.xml")!);
    expect(xml).toContain("Ana &amp; &lt;Ríos&gt;");
    expect(xml).toContain(">987654321<");
    expect(xml).toContain('<c r="I2"><v>69.9</v></c>');
    expect(xml).not.toContain("\u0001");
    const table = await entryText(entryByName(entries, "xl/tables/table2.xml")!);
    expect(table).toMatch(/ref="[A-Z]+1:[A-Z]+2"/);
    // las macros del courier se copian intactas
    expect(entryByName(entries, "xl/vbaProject.bin")).toBeTruthy();
  });
});

describe("Pedido de Vendia → plantilla", () => {
  it("usa la medida del pedido, luego la oferta y luego el producto", () => {
    const o = toCourierOrder({
      order_number: 10,
      customer_name: "Rosa",
      customer_phone: "51911111111",
      dni: "12345678",
      district_name: "Abancay",
      province_name: "Abancay",
      department_name: "Apurímac",
      address: "Jr. 1",
      reference: null,
      balance_due: "50.00",
      agency_destination: null,
      package_size: null,
      package_weight: null,
      items: [
        {
          product_name: "Faja",
          offer_name: "2 u",
          quantity: 2,
          product: { package_size: "PAQUETE S", package_weight: "1", package_height: "0", package_width: "0", package_length: "0" },
          offer: { package_size: "PAQUETE M", package_weight: null },
        },
      ],
    });
    expect(o).toMatchObject({ packageSize: "PAQUETE M", weight: 1, city: "Abancay", amountToCollect: 50, description: "Faja (2 u)" });
    expect(suggestAgency(o.city)).toBe("ABANCAY");
  });
});
