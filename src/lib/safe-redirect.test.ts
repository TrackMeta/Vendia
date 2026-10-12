import { describe, expect, it } from "vitest";
import { safeRedirectPath } from "./safe-redirect";

describe("Destino después de ingresar", () => {
  it("acepta rutas de Vendia", () => {
    expect(safeRedirectPath("/dashboard/pedidos?estado=new")).toBe("/dashboard/pedidos?estado=new");
    expect(safeRedirectPath("/invitacion/abc")).toBe("/invitacion/abc");
  });

  it("rechaza otros dominios", () => {
    for (const bad of ["//evil.com", "/\\evil.com", "https://evil.com", "/\t/evil.com", "evil.com", "", null, "/%5Cevil.com".replace("%5C", "\\")]) {
      expect(safeRedirectPath(bad)).toBe("/dashboard");
    }
    expect(safeRedirectPath("//evil.com", "/onboarding")).toBe("/onboarding");
  });
});
