import { describe, expect, it } from "vitest";
import { buildFbc, paramsFromUrl } from "./capture";

describe("Atribución", () => {
  it("extrae UTMs, fbclid e IDs de Meta de la URL", () => {
    const result = paramsFromUrl(
      "?utm_source=facebook&utm_medium=paid&utm_campaign=Faja%20Oct&utm_content=Video%201&campaign_id=120200&adset_id=120201&ad_id=120202&fbclid=IwAR3xYz&otro=1",
    );
    expect(result).toEqual({
      utm_source: "facebook",
      utm_medium: "paid",
      utm_campaign: "Faja Oct",
      utm_content: "Video 1",
      campaign_id: "120200",
      adset_id: "120201",
      ad_id: "120202",
      fbclid: "IwAR3xYz",
    });
  });

  it("ignora parámetros vacíos y desconocidos", () => {
    expect(paramsFromUrl("?utm_source=&foo=bar")).toEqual({});
  });

  it("construye fbc con el formato de Meta sin alterar el fbclid", () => {
    expect(buildFbc("AbC123", 1700000000000)).toBe("fb.1.1700000000000.AbC123");
  });
});

describe("Atribución: largos máximos", () => {
  it("recorta cada parámetro al largo que acepta el servidor", () => {
    const long = "9".repeat(70);
    const result = paramsFromUrl(`?campaign_id=${long}&adset_id=${long}&ad_id=${long}&utm_source=${"s".repeat(300)}`);
    expect(result.campaign_id).toHaveLength(64);
    expect(result.adset_id).toHaveLength(64);
    expect(result.ad_id).toHaveLength(64);
    expect(result.utm_source).toHaveLength(255);
  });
});
