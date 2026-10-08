import { describe, expect, it } from "vitest";
import { itemLabel, variantsLabel } from "./items";

describe("Etiqueta de la línea del pedido", () => {
  it("incluye oferta y variantes", () => {
    const breakdown = [
      { variant_id: "a", name: "M", quantity: 1 },
      { variant_id: "b", name: "L", quantity: 2 },
    ];
    expect(variantsLabel(breakdown)).toBe("M, L ×2");
    expect(itemLabel({ product_name: "Faja", offer_name: "3 unidades", variant_breakdown: breakdown })).toBe("Faja (3 unidades) · M, L ×2");
    expect(itemLabel({ product_name: "Faja" })).toBe("Faja");
  });
});
