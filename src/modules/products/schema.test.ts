import { describe, expect, it } from "vitest";
import { offersInput } from "./schema";

const offer = { name: "2 unidades", quantity: 2, price: 134.3, compare_at_price: 158, badge: null, image_path: null, is_default: false, is_active: true };

describe("Ofertas por cantidad", () => {
  it("guarda sin etiqueta (la pantalla manda null)", () => {
    const r = offersInput.safeParse([{ ...offer, is_default: true }, offer]);
    expect(r.success).toBe(true);
    expect(r.data?.[0].badge).toBeNull();
  });

  it("sin precio tachado queda vacío, no en 0", () => {
    const r = offersInput.safeParse([{ ...offer, compare_at_price: null }]);
    expect(r.data?.[0].compare_at_price).toBeNull();
    expect(offersInput.safeParse([{ ...offer, compare_at_price: "" }]).data?.[0].compare_at_price).toBeNull();
    expect(offersInput.safeParse([{ ...offer, compare_at_price: 129 }]).data?.[0].compare_at_price).toBe(129);
  });

  it("etiqueta con texto se guarda", () => {
    expect(offersInput.safeParse([{ ...offer, badge: " Lo más vendido " }]).data?.[0].badge).toBe("Lo más vendido");
  });
});
