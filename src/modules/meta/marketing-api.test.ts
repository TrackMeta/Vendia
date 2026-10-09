import { describe, expect, it } from "vitest";
import { cleanToken, fetchAdCreatives, fetchInsights, friendlyMetaError, grantAdAccountAccess, inspectToken, leadsFrom, MetaApiError } from "./marketing-api";

/** fetch simulado: responde según la ruta y guarda las URLs pedidas. */
function mockFetch(routes: Record<string, unknown>) {
  const calls: string[] = [];
  const f = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const key = Object.keys(routes).find((k) => url.includes(k));
    const body = key ? routes[key] : { error: { message: "ruta no simulada", code: 100 } };
    const isError = typeof body === "object" && body !== null && "error" in body;
    return new Response(JSON.stringify(body), { status: isError ? 400 : 200 });
  }) as typeof fetch;
  return { f, calls };
}

describe("Leads de Meta", () => {
  it("toma el mayor de los tipos de lead (no los suma)", () => {
    expect(leadsFrom([{ action_type: "lead", value: "5" }, { action_type: "offsite_conversion.fb_pixel_lead", value: "5" }, { action_type: "link_click", value: "90" }])).toBe(5);
    expect(leadsFrom(undefined)).toBe(0);
    expect(leadsFrom([{ action_type: "link_click", value: "3" }])).toBe(0);
  });
});

describe("Token y cuentas", () => {
  it("lista las cuentas publicitarias con moneda, siguiendo la paginación", async () => {
    const { f, calls } = mockFetch({
      "/me?": { id: "1", name: "Vendia Sistema" },
      "/me/adaccounts": { data: [{ id: "act_111", name: "Cuenta Soles", currency: "PEN", account_status: 1 }], paging: { next: "https://graph.facebook.com/next-page" } },
      "next-page": { data: [{ id: "act_222", name: "Cuenta USD", currency: "USD", account_status: 1, business: { name: "Mi BM" } }] },
    });
    const r = await inspectToken("TOKEN", f);
    expect(r.userName).toBe("Vendia Sistema");
    expect(r.accounts.map((a) => [a.id, a.currency, a.business])).toEqual([
      ["act_111", "PEN", null],
      ["act_222", "USD", "Mi BM"],
    ]);
    expect(calls[0]).toContain("access_token=TOKEN");
  });

  it("muestra las cuentas del Business Manager que aún no están asignadas", async () => {
    const { f } = mockFetch({
      "/me?": { id: "999", name: "Vendia Sistema" },
      "/me/adaccounts": { data: [{ id: "act_111", name: "Cuenta 1", currency: "PEN", account_status: 1, business: { id: "555", name: "Mi BM" } }] },
      "/555/owned_ad_accounts": {
        data: [
          { id: "act_111", name: "Cuenta 1", currency: "PEN", account_status: 1 },
          { id: "act_333", name: "Cuenta nueva", currency: "USD", account_status: 1 },
        ],
      },
      "/555/client_ad_accounts": { data: [] },
      // /me/businesses no simulado: Meta puede negarlo y no debe romper nada
    });
    const r = await inspectToken("TOKEN", f);
    expect(r.userId).toBe("999");
    expect(r.accounts.map((a) => [a.id, a.assigned, a.businessId])).toEqual([
      ["act_111", true, "555"],
      ["act_333", false, "555"],
    ]);
  });

  it("pide acceso a una cuenta para el usuario del sistema", async () => {
    const calls: { url: string; body: string }[] = [];
    const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), body: String(init?.body ?? "") });
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }) as typeof fetch;
    await grantAdAccountAccess("TOKEN", "act_333", "555", "999", f);
    expect(calls[0].url).toContain("/act_333/assigned_users");
    const body = new URLSearchParams(calls[0].body);
    expect(body.get("user")).toBe("999");
    expect(body.get("business")).toBe("555");
    expect(JSON.parse(body.get("tasks")!)).toEqual(["MANAGE", "ADVERTISE", "ANALYZE"]);
  });

  it("limpia lo que se pega de más sin tocar el token", () => {
    const token = "EAAGm0PX4ZCpsBAKZB9sxyz123ABCs";
    expect(cleanToken(token)).toBe(token);
    expect(cleanToken(`  "Bearer ${token}"\n`)).toBe(token);
    expect(cleanToken("EAAGm0PX4ZC\npsBAKZB9 sxyz123ABCs")).toBe(token);
  });

  it("explica los errores de token y permisos", async () => {
    const { f } = mockFetch({ "/me?": { error: { message: "Invalid OAuth access token", code: 190 } } });
    await expect(inspectToken("x", f)).rejects.toThrow(/expiró/);
    expect(friendlyMetaError(200, "")).toMatch(/permisos/);
    expect(new MetaApiError("x", 190).code).toBe(190);
  });
});

describe("Métricas y creatividades", () => {
  it("convierte las métricas diarias por anuncio", async () => {
    const { f, calls } = mockFetch({
      "/insights": {
        data: [
          {
            date_start: "2026-10-07",
            campaign_id: "1",
            campaign_name: "C",
            adset_id: "2",
            adset_name: "S",
            ad_id: "3",
            ad_name: "A",
            spend: "12.34",
            impressions: "1000",
            reach: "800",
            inline_link_clicks: "40",
            actions: [{ action_type: "lead", value: "4" }],
          },
        ],
      },
    });
    const rows = await fetchInsights("T", "act_111", "2026-10-05", "2026-10-07", f);
    expect(rows[0]).toMatchObject({ date: "2026-10-07", adId: "3", spend: 12.34, impressions: 1000, clicks: 40, results: 4 });
    expect(decodeURIComponent(calls[0])).toContain('time_range={"since":"2026-10-05","until":"2026-10-07"}');
    expect(calls[0]).toContain("level=ad");
  });

  it("lee la creatividad de los anuncios de 50 en 50", async () => {
    const { f, calls } = mockFetch({
      "ids=": { "3": { id: "3", effective_status: "ACTIVE", preview_shareable_link: "https://fb.me/x", creative: { thumbnail_url: "https://img/x.jpg", body: "Texto" } } },
    });
    const ads = await fetchAdCreatives("T", ["3"], f);
    expect(ads[0]).toEqual({ id: "3", status: "ACTIVE", thumbnailUrl: "https://img/x.jpg", body: "Texto", title: null, previewUrl: "https://fb.me/x" });
    const many = await fetchAdCreatives("T", Array.from({ length: 120 }, (_, i) => String(i)), f);
    expect(many).toHaveLength(3); // el mock siempre devuelve el mismo anuncio por llamada
    expect(calls).toHaveLength(4);
  });
});
