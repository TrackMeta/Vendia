import { describe, expect, it } from "vitest";
import { orderInput, splitFullName } from "./order-input";

const valid = {
  landing_page_id: "3f1c2b8e-7a4d-4e0b-9c1a-2b3c4d5e6f70",
  offer_id: "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d",
  idempotency_key: "abc12345-key",
  first_name: "María",
  last_name: "Rojas",
  phone: "987 654 321",
  district_code: "150133",
  address: "Av. Los Héroes 123",
  reference: "Frente al parque",
  attribution: { utm_source: "facebook", campaign_id: "120200" },
};

describe("Datos del pedido COD", () => {
  it("acepta un pedido válido y normaliza el celular", () => {
    const parsed = orderInput.parse(valid);
    expect(parsed.phone).toBe("51987654321");
    expect(parsed.attribution.campaign_id).toBe("120200");
  });

  it("ignora cualquier precio enviado por el navegador", () => {
    const parsed = orderInput.parse({ ...valid, total: 1, price: 0.01 }) as Record<string, unknown>;
    expect(parsed.total).toBeUndefined();
    expect(parsed.price).toBeUndefined();
  });

  it("rechaza celulares inválidos, distritos mal formados y direcciones vacías", () => {
    expect(orderInput.safeParse({ ...valid, phone: "12345" }).success).toBe(false);
    expect(orderInput.safeParse({ ...valid, district_code: "15013" }).success).toBe(false);
    expect(orderInput.safeParse({ ...valid, address: "" }).success).toBe(false);
  });

  it("rechaza si el campo trampa anti-bots viene lleno", () => {
    expect(orderInput.safeParse({ ...valid, website: "http://spam" }).success).toBe(false);
  });

  it("valida DNI de 8 dígitos solo si se envía", () => {
    expect(orderInput.safeParse({ ...valid, dni: "1234" }).success).toBe(false);
    expect(orderInput.safeParse({ ...valid, dni: "12345678" }).success).toBe(true);
    expect(orderInput.safeParse({ ...valid, dni: "" }).success).toBe(true);
  });
});

describe("Nombre completo", () => {
  it("separa nombre y apellido", () => {
    expect(splitFullName("Jorge")).toEqual({ first_name: "Jorge" });
    expect(splitFullName("Jorge Salazar")).toEqual({ first_name: "Jorge", last_name: "Salazar" });
    expect(splitFullName(" María  Fernanda Rojas Díaz ")).toEqual({ first_name: "María Fernanda", last_name: "Rojas Díaz" });
  });
});
