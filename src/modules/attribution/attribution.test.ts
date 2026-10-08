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
