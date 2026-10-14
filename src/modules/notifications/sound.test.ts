import { describe, expect, it } from "vitest";
import { DEFAULT_SOUND_PREFS, parseSoundPrefs, shouldPlay } from "./sound";

describe("Sonido de los avisos", () => {
  it("lo guardado vuelve tal cual y lo raro al predeterminado", () => {
    expect(parseSoundPrefs(JSON.stringify({ enabled: false, sound: "caja", volume: "alto", onlyOrders: true }))).toEqual({
      enabled: false,
      sound: "caja",
      volume: "alto",
      onlyOrders: true,
    });
    expect(parseSoundPrefs(JSON.stringify({ sound: "trompeta", volume: "fuerte" }))).toEqual(DEFAULT_SOUND_PREFS);
    expect(parseSoundPrefs("no es json")).toEqual(DEFAULT_SOUND_PREFS);
    expect(parseSoundPrefs(null)).toEqual(DEFAULT_SOUND_PREFS);
  });

  it("apagado no suena; «solo pedidos nuevos» deja en silencio lo demás", () => {
    expect(shouldPlay({ ...DEFAULT_SOUND_PREFS, enabled: false }, "new_order")).toBe(false);
    expect(shouldPlay({ ...DEFAULT_SOUND_PREFS, onlyOrders: true }, "new_order")).toBe(true);
    expect(shouldPlay({ ...DEFAULT_SOUND_PREFS, onlyOrders: true }, "other")).toBe(false);
    expect(shouldPlay(DEFAULT_SOUND_PREFS, "other")).toBe(true);
  });
});
