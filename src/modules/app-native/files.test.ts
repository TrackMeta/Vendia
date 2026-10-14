import { describe, expect, it } from "vitest";
import { fileNameFrom, mimeFor } from "./files";

describe("archivos en la app de celular", () => {
  it("lee el nombre que manda el servidor", () => {
    expect(fileNameFrom('attachment; filename="pedidos-demo-2026-10-14.csv"', "x")).toBe("pedidos-demo-2026-10-14.csv");
    expect(fileNameFrom("attachment; filename*=UTF-8''r%C3%B3tulos.pdf", "x")).toBe("rótulos.pdf");
    expect(fileNameFrom(null, "archivo.csv")).toBe("archivo.csv");
  });

  it("tipo por extensión", () => {
    expect(mimeFor("Shalom.xlsx")).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(mimeFor("a.csv")).toBe("text/csv");
    expect(mimeFor("sin-extension")).toBe("application/octet-stream");
  });
});
