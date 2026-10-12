import { describe, expect, it } from "vitest";
import { orderSearchFilters } from "./search";

describe("Búsqueda de pedidos", () => {
  it("por DNI, celular o número", () => {
    const f = orderSearchFilters("45678912");
    expect(f).toContain("dni.ilike.%45678912%");
    expect(f).toContain("customer_phone.ilike.%45678912%");
    expect(f).toContain("order_number.eq.45678912");
    expect(orderSearchFilters("#1003")).toContain("order_number.eq.1003");
  });

  it("por ubicación o nombre", () => {
    const f = orderSearchFilters("Arequipa");
    expect(f).toEqual(
      expect.arrayContaining(["customer_name.ilike.%Arequipa%", "district_name.ilike.%Arequipa%", "province_name.ilike.%Arequipa%", "department_name.ilike.%Arequipa%"]),
    );
    expect(f.some((x) => x.startsWith("dni"))).toBe(false);
  });

  it("limpia lo que rompe el filtro", () => {
    expect(orderSearchFilters("San (Isidro), %x")).toContain("district_name.ilike.%San Isidro x%");
    expect(orderSearchFilters("a")).toEqual([]);
  });
});
