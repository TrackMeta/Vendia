import { describe, expect, it } from "vitest";
import { mapsLink, parseDeliveryLocation } from "./location";

describe("Ubicación de entrega", () => {
  it("acepta coordenadas y las deja limpias", () => {
    expect(parseDeliveryLocation("-12.0464,-77.0428")).toEqual({ ok: true, value: "-12.0464, -77.0428" });
    expect(parseDeliveryLocation("  -12.0464, -77.0428 ")).toEqual({ ok: true, value: "-12.0464, -77.0428" });
  });

  it("acepta links de Google Maps, aunque vengan dentro de un texto de WhatsApp", () => {
    const r = parseDeliveryLocation("Mi ubicación: https://maps.app.goo.gl/AbC123xyz gracias");
    expect(r).toEqual({ ok: true, value: "https://maps.app.goo.gl/AbC123xyz" });
    expect(parseDeliveryLocation("https://www.google.com/maps?q=-12.1,-77.0").ok).toBe(true);
  });

  it("rechaza lo que no es una ubicación", () => {
    expect(parseDeliveryLocation("Av. Larco 123").ok).toBe(false);
    expect(parseDeliveryLocation("https://ejemplo.com/mapa").ok).toBe(false);
    expect(parseDeliveryLocation("200, 300").ok).toBe(false);
  });

  it("vacío = sin ubicación", () => {
    expect(parseDeliveryLocation("")).toEqual({ ok: true, value: null });
  });

  it("arma el link para abrir el mapa", () => {
    expect(mapsLink("-12.0464, -77.0428")).toBe("https://www.google.com/maps?q=-12.0464,-77.0428");
    expect(mapsLink("https://maps.app.goo.gl/AbC")).toBe("https://maps.app.goo.gl/AbC");
    expect(mapsLink(null)).toBeNull();
  });
});
