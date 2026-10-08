import { describe, expect, it } from "vitest";
import { compressionPlan, DEFAULT_MAX_WIDTH } from "./image-sizing";

describe("Plan de compresión de imágenes", () => {
  it("una foto horizontal grande queda en 1080 px de ancho y ~250 KB", () => {
    expect(compressionPlan(4000, 3000)).toEqual({ maxWidthOrHeight: 1080, maxSizeMB: 0.25 });
  });

  it("una imagen vertical alta de landing (1080×3240) conserva sus 1080 px de ancho", () => {
    const plan = compressionPlan(1080, 3240);
    // el lado más largo es el alto: así el ancho final sigue siendo 1080
    expect(plan.maxWidthOrHeight).toBe(3240);
    expect(plan.maxSizeMB).toBe(0.6);
  });

  it("una imagen vertical más grande se reduce a 1080 de ancho manteniendo la proporción", () => {
    expect(compressionPlan(2160, 6480).maxWidthOrHeight).toBe(3240);
  });

  it("no agranda imágenes pequeñas y respeta anchos máximos menores (logos, avatares)", () => {
    expect(compressionPlan(600, 600).maxWidthOrHeight).toBe(600);
    expect(compressionPlan(2000, 2000, 200)).toMatchObject({ maxWidthOrHeight: 200 });
  });

  it("limita el peso máximo a 1 MB y la altura a 6000 px", () => {
    const plan = compressionPlan(DEFAULT_MAX_WIDTH, 20000);
    expect(plan.maxSizeMB).toBe(1);
    expect(plan.maxWidthOrHeight).toBe(6000);
  });

  it("sin dimensiones usa valores por defecto", () => {
    expect(compressionPlan(0, 0)).toEqual({ maxWidthOrHeight: 1080, maxSizeMB: 0.25 });
  });
});
