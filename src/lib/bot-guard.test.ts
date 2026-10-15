import { describe, expect, it } from "vitest";
import { looksLikeBot, MIN_FILL_MS, trippedTrap } from "./bot-guard";

const PHONES = [
  // Chrome en Android, navegador de Facebook/Instagram/TikTok, iPhone y un celular CUBOT: siempre pasan
  "Mozilla/5.0 (Linux; Android 13; SM-A145M) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
  "Mozilla/5.0 (Linux; Android 12; moto g(30) Build/S0RC32; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/119.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/440.0.0.31.105;]",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 307.0.0.34.111",
  "Mozilla/5.0 (Linux; Android 11; CUBOT X50 Build/RP1A) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0 Mobile Safari/537.36",
  "Mozilla/5.0 (Linux; Android 12; 23021RAAEG Build/SP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/119.0 Mobile Safari/537.36 trill_310203 musical_ly",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
];

const BOTS = [
  "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0.0.0 Safari/537.36",
  "python-requests/2.31.0",
  "curl/8.4.0",
  "node",
  "",
];

describe("Filtro de robots", () => {
  it("los celulares de clientes reales nunca se marcan como robot", () => {
    expect(PHONES.filter(looksLikeBot)).toEqual([]);
  });

  it("los robots y programas se reconocen", () => {
    expect(BOTS.filter((ua) => !looksLikeBot(ua))).toEqual([]);
    expect(looksLikeBot(null)).toBe(true);
  });
});

describe("Trampa del formulario", () => {
  it("el campo escondido lleno es de robot", () => {
    expect(trippedTrap("https://spam.example", 30_000)).toBe(true);
  });

  it("llenar el formulario en menos de un segundo y medio es de robot", () => {
    expect(trippedTrap(undefined, 300)).toBe(true);
    expect(trippedTrap(undefined, MIN_FILL_MS)).toBe(false);
  });

  it("una persona normal (o una página abierta antes de esta versión) pasa", () => {
    expect(trippedTrap(undefined, 25_000)).toBe(false);
    expect(trippedTrap("", 25_000)).toBe(false);
    expect(trippedTrap(undefined, undefined)).toBe(false);
  });
});
