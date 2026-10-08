import { describe, expect, it } from "vitest";
import { buildSequence, nextStepIndex, sequenceLabels, sortForConfirmation, zoneOf } from "./contact";

describe("Secuencia de contacto", () => {
  it("etiqueta los pasos por defecto", () => {
    expect(sequenceLabels(["call", "call", "call", "whatsapp"])).toEqual(["Llamada 1", "Llamada 2", "Llamada 3", "WhatsApp"]);
    expect(sequenceLabels(["call", "whatsapp", "call", "whatsapp"])).toEqual(["Llamada 1", "WhatsApp 1", "Llamada 2", "WhatsApp 2"]);
  });

  it("indica el paso siguiente y el fin de la secuencia", () => {
    expect(nextStepIndex(0, ["call", "call"])).toBe(0);
    expect(nextStepIndex(1, ["call", "call"])).toBe(1);
    expect(nextStepIndex(2, ["call", "call"])).toBeNull();
  });

  it("arma la secuencia desde la configuración simple", () => {
    expect(buildSequence(3, true)).toEqual(["call", "call", "call", "whatsapp"]);
    expect(buildSequence(2, false)).toEqual(["call", "call"]);
    expect(buildSequence(0, true)).toEqual(["whatsapp"]);
    expect(buildSequence(0, false)).toEqual(["call"]);
    expect(buildSequence(99, false)).toHaveLength(6);
  });
});

describe("Zona", () => {
  it("Lima Metropolitana y Callao son Lima; el resto, provincia", () => {
    expect(zoneOf("1501")).toBe("lima");
    expect(zoneOf("0701")).toBe("lima");
    expect(zoneOf("1502")).toBe("provincia"); // Barranca (departamento Lima, pero provincia)
    expect(zoneOf("0401")).toBe("provincia");
  });
});

describe("Orden de la bandeja Por confirmar", () => {
  const now = Date.parse("2026-10-08T15:00:00Z");
  const o = (id: string, extra: Partial<{ next_contact_at: string | null; contact_attempts: number; created_at: string; last_contact_at: string | null }>) => ({
    id,
    next_contact_at: null,
    contact_attempts: 0,
    created_at: "2026-10-08T10:00:00Z",
    last_contact_at: null,
    ...extra,
  });

  it("primero las llamadas pactadas vencidas, luego los nuevos, luego los en secuencia, al final los pactados a futuro", () => {
    const sorted = sortForConfirmation(
      [
        o("futuro", { contact_attempts: 1, next_contact_at: "2026-10-08T18:00:00Z" }),
        o("en-secuencia", { contact_attempts: 2, last_contact_at: "2026-10-08T12:00:00Z" }),
        o("nuevo-reciente", { created_at: "2026-10-08T14:00:00Z" }),
        o("vencido", { contact_attempts: 1, next_contact_at: "2026-10-08T14:30:00Z" }),
        o("nuevo-antiguo", { created_at: "2026-10-08T09:00:00Z" }),
      ],
      now,
    );
    expect(sorted.map((x) => x.id)).toEqual(["vencido", "nuevo-antiguo", "nuevo-reciente", "en-secuencia", "futuro"]);
  });
});
