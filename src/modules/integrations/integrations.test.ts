import { describe, expect, it } from "vitest";
import { buildCourierCsv } from "./courier-export";

describe("Exportación para courier", () => {
  it("genera una fila por pedido con ubigeo y monto a cobrar", () => {
    const csv = buildCourierCsv([
      {
        order_number: 1001,
        created_at: "2026-10-08T15:00:00Z",
        customer_name: "Ana Rojas",
        customer_phone: "51987654321",
        dni: null,
        department_name: "Lima",
        province_name: "Lima",
        district_name: "San Juan de Miraflores",
        district_code: "150133",
        address: "Av. Los Héroes 123",
        reference: "Frente al parque",
        balance_due: 119.9,
        total: 139.9,
        customer_notes: null,
        items: [{ product_name: "Faja", offer_name: "2 unidades", quantity: 2 }],
      },
    ]);
    const lines = csv.replace("﻿", "").split("\r\n");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe("1001,2026-10-08,Ana Rojas,987654321,,Lima,Lima,San Juan de Miraflores,150133,Av. Los Héroes 123,Frente al parque,Faja (2 unidades),2,119.90,139.90,");
  });
});
