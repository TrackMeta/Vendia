import { describe, expect, it } from "vitest";
import { buildServerEvent, isTooOld, leadEventId, purchaseEventId } from "./events";
import { buildUserData, normalizeLocation, normalizeName, normalizePhone, sha256 } from "./user-data";

describe("Meta user_data", () => {
  it("normaliza teléfono peruano con código de país", () => {
    expect(normalizePhone("987 654 321")).toBe("51987654321");
    expect(normalizePhone("+51 987-654-321")).toBe("51987654321");
    expect(normalizePhone("0051987654321")).toBe("51987654321");
  });

  it("normaliza nombres (minúsculas, sin puntuación, conserva tildes)", () => {
    expect(normalizeName("  María-José ")).toBe("maríajosé");
    expect(normalizeName("O'Brien")).toBe("obrien");
  });

  it("normaliza ciudad/región sin espacios ni tildes", () => {
    expect(normalizeLocation("San Juan de Lurigancho")).toBe("sanjuandelurigancho");
    expect(normalizeLocation("Apurímac")).toBe("apurimac");
  });

  it("hashea con SHA-256 los datos personales y NO hashea ip, user agent, fbc, fbp", () => {
    const data = buildUserData({
      phone: "987654321",
      firstName: "Ana",
      lastName: "Rojas",
      city: "Lima",
      region: "Lima",
      externalId: "cust-1",
      clientIp: "190.1.2.3",
      userAgent: "Mozilla/5.0",
      fbc: "fb.1.1700000000000.AbC",
      fbp: "fb.1.1700000000000.123",
    });
    expect(data.ph).toEqual([sha256("51987654321")]);
    expect(data.fn).toEqual([sha256("ana")]);
    expect(data.country).toEqual([sha256("pe")]);
    expect(data.client_ip_address).toBe("190.1.2.3");
    expect(data.fbc).toBe("fb.1.1700000000000.AbC");
    expect(data.ph?.[0]).toMatch(/^[a-f0-9]{64}$/);
  });

  it("omite campos vacíos", () => {
    const data = buildUserData({ phone: null, firstName: "" });
    expect(data.ph).toBeUndefined();
    expect(data.fn).toBeUndefined();
  });
});

describe("Eventos de servidor", () => {
  it("usa event_id estable para deduplicar Pixel + CAPI", () => {
    expect(leadEventId("abc")).toBe("lead_abc");
    expect(purchaseEventId("abc")).toBe("purchase_abc");
  });

  it("construye un Purchase con moneda PEN y valor redondeado", () => {
    const e = buildServerEvent({
      eventName: "Purchase",
      eventId: "purchase_1",
      eventTime: new Date("2026-10-08T15:00:00Z"),
      userData: {},
      value: 139.899999,
      productId: "p1",
      quantity: 2,
      orderNumber: 1001,
      sourceUrl: "https://x.pe/p/a/b",
    });
    expect(e.action_source).toBe("website");
    expect(e.event_time).toBe(1791471600);
    expect(e.custom_data).toEqual({ currency: "PEN", value: 139.9, content_ids: ["p1"], content_type: "product", num_items: 2, order_id: "1001" });
    expect(e.event_source_url).toBe("https://x.pe/p/a/b");
  });

  it("detecta eventos demasiado antiguos (límite de 7 días de Meta)", () => {
    const now = Date.parse("2026-10-08T00:00:00Z");
    expect(isTooOld(now / 1000 - 3600, now)).toBe(false);
    expect(isTooOld(now / 1000 - 8 * 24 * 3600, now)).toBe(true);
  });
});
