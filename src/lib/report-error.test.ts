import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: async () => ({}) }) }));

describe("Registro de errores", () => {
  it("agrupa el mismo error en páginas con distinto id", async () => {
    const { errorFingerprint, routePattern } = await import("./report-error");
    expect(routePattern("/dashboard/pedidos/0a0f2f40-a461-4dda-8a1d-23c04d13cc09?x=1")).toBe("/dashboard/pedidos/:id");
    const a = errorFingerprint({ source: "server", message: "Fallo en pedido 1002", path: "/dashboard/pedidos/0a0f2f40-a461-4dda-8a1d-23c04d13cc09" });
    const b = errorFingerprint({ source: "server", message: "Fallo en pedido 1003", path: "/dashboard/pedidos/1b0f2f40-a461-4dda-8a1d-23c04d13cc09" });
    const c = errorFingerprint({ source: "client", message: "Fallo en pedido 1002", path: "/dashboard/pedidos/x" });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toHaveLength(40);
  });
});
