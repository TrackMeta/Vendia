import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildCourierCsv } from "./courier-export";
import { getProvider } from "./registry";
import { genericWebhookPayload, mapStatus, parseSignatureHeader } from "./webhook";

describe("Webhook genérico", () => {
  it("traduce estados en español e inglés", () => {
    expect(mapStatus("Entregado")).toBe("delivered");
    expect(mapStatus("en ruta")).toBe("out_for_delivery");
    expect(mapStatus("NO ENTREGADO")).toBe("failed_delivery");
    expect(mapStatus("returned")).toBe("returned");
    expect(mapStatus("perdido")).toBeNull();
  });

  it("valida el cuerpo: requiere event_id y número de pedido o ID externo", () => {
    expect(genericWebhookPayload.safeParse({ event_id: "e1", order_number: 1001, status: "entregado" }).success).toBe(true);
    expect(genericWebhookPayload.safeParse({ event_id: "e1", status: "entregado" }).success).toBe(false);
    expect(genericWebhookPayload.safeParse({ order_number: 1, status: "entregado" }).success).toBe(false);
  });

  it("lee la firma HMAC-SHA256 del header", () => {
    const body = JSON.stringify({ event_id: "e1" });
    const sig = createHmac("sha256", "secreto").update(body).digest("hex");
    expect(parseSignatureHeader(`sha256=${sig}`)).toBe(sig);
    expect(parseSignatureHeader(sig.toUpperCase())).toBe(sig);
    expect(parseSignatureHeader("sha256=abc")).toBeNull();
    expect(parseSignatureHeader(null)).toBeNull();
  });
});

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

describe("Proveedores", () => {
  it("Releasit está marcado como no disponible con su motivo", () => {
    const releasit = getProvider("releasit");
    expect(releasit?.available).toBe(false);
    expect(releasit?.unavailableReason).toMatch(/no publica una API/);
  });
});
