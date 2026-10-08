import { describe, expect, it } from "vitest";
import { displayPhone, getCountry, normalizePhone } from "./index";

describe("Módulo de país (Perú)", () => {
  const pe = getCountry("pe");

  it("datos del país", () => {
    expect([pe.currency, pe.tax.name, pe.tax.rate]).toEqual(["PEN", "IGV", 0.18]);
    expect(getCountry("XX").code).toBe("PE");
  });

  it("zonas de envío", () => {
    expect(pe.zoneOf("1501")).toBe("lima");
    expect(pe.zoneOf("0701")).toBe("lima");
    expect(pe.zoneOf("0401")).toBe("provincia");
  });

  it("celulares", () => {
    expect(normalizePhone("987 654 321")).toBe("51987654321");
    expect(normalizePhone("+51 987654321")).toBe("51987654321");
    expect(normalizePhone("0051987654321")).toBe("51987654321");
    expect(normalizePhone("012345678")).toBeNull();
    expect(displayPhone("51987654321")).toBe("987 654 321");
  });
});
