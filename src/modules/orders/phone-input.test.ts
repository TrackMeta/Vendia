import { describe, expect, it } from "vitest";
import { cleanPhoneInput } from "./phone-input";

describe("Celular pegado en el formulario", () => {
  it("quita el código de país +51 al pegar", () => {
    expect(cleanPhoneInput("+51 987 654 321")).toBe("987 654 321");
    expect(cleanPhoneInput("51987654321")).toBe("987 654 321");
    expect(cleanPhoneInput("0051 987654321")).toBe("987 654 321");
    expect(cleanPhoneInput("+51-987-654-321")).toBe("987 654 321");
  });

  it("deja tal cual un celular de 9 dígitos mientras se escribe", () => {
    expect(cleanPhoneInput("987 654 321")).toBe("987 654 321");
    expect(cleanPhoneInput("987654")).toBe("987654");
    expect(cleanPhoneInput("98a7")).toBe("987");
  });

  it("no deja pasar de 11 dígitos", () => {
    expect(cleanPhoneInput("1234567890123")).toBe("12345678901");
  });
});
