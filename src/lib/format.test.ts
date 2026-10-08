import { describe, expect, it } from "vitest";
import { displayPeruPhone, formatMoney, normalizePeruPhone, slugify } from "./format";

describe("formato", () => {
  it("moneda en soles", () => {
    expect(formatMoney(89.9)).toBe("S/ 89.90");
    expect(formatMoney(null)).toBe("—");
  });

  it("normaliza celulares peruanos", () => {
    expect(normalizePeruPhone("987 654 321")).toBe("51987654321");
    expect(normalizePeruPhone("+51 987-654-321")).toBe("51987654321");
    expect(normalizePeruPhone("0051987654321")).toBe("51987654321");
    expect(normalizePeruPhone("12345")).toBeNull();
    expect(normalizePeruPhone("812345678")).toBeNull();
    expect(displayPeruPhone("51987654321")).toBe("987 654 321");
  });

  it("slugify", () => {
    expect(slugify("Faja Reductora Térmica!")).toBe("faja-reductora-termica");
  });
});
