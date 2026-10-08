/**
 * Punta a punta (HTTP real contra la app corriendo): landing pública → pedido → gracias → upsell,
 * formulario abandonado, errores del navegador y dominio propio.
 * Ejecutar: npm run build && npm run start -- -p 3001 (en otra terminal) y luego npm run test:e2e
 */
import { request as httpRequest } from "node:http";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTemplate } from "@/modules/landing/defaults";
import { landingContent } from "@/modules/landing/schema";

config({ path: ".env.local", quiet: true });

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3001";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const admin = createClient(url, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
const runId = `${Date.now().toString(36)}e2e`;

let owner: { id: string; client: SupabaseClient };
let storeId: string;
let storeSlug: string;
let landingId: string;
let offerId: string;
let orderId: string;
const domain = `${runId}.vendia-e2e.test`;

/** GET con otro Host (fetch no permite cambiar Host: el estándar lo prohíbe). */
function getWithHost(path: string, host: string): Promise<{ status: number; body: string }> {
  const base = new URL(BASE);
  return new Promise((resolve, reject) => {
    const req = httpRequest({ hostname: base.hostname, port: base.port, path, method: "GET", headers: { host } }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

beforeAll(async () => {
  const email = `vendia-test-owner-${runId}@example.com`;
  const password = `Test-${runId}-Pass!`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const client = createClient(url, publishable, { auth: { persistSession: false, autoRefreshToken: false } });
  await client.auth.signInWithPassword({ email, password });
  owner = { id: data.user.id, client };
  storeSlug = `e2e-${runId}`;
  const { data: sid } = await client.rpc("create_store", { p_name: "Tienda E2E", p_slug: storeSlug });
  storeId = sid as string;
  const { data: p } = await client.from("products").insert({ store_id: storeId, name: "Faja E2E", price: 100, cost: 30, status: "active" }).select("id").single();
  const { data: o } = await client.from("product_offers").insert({ store_id: storeId, product_id: p!.id, name: "1 unidad", quantity: 1, price: 100, is_default: true }).select("id").single();
  offerId = o!.id;
  const content = landingContent.parse({
    ...createTemplate("producto"),
    form_blocks: [...createTemplate("producto").form_blocks, { id: "b", type: "form_bumps", bg: "#ffffff", accent: "#ea580c", items: [{ id: "extra", name: "Guía", price: 10 }] }],
    thank_you_upsell: { enabled: true, name: "Segunda faja", price: 50 },
  });
  const { data: l } = await client.from("landing_pages").insert({ store_id: storeId, product_id: p!.id, title: "Faja E2E", slug: "faja", content }).select("id").single();
  landingId = l!.id;
  const pub = await client.rpc("publish_landing_page", { p_landing_id: landingId });
  if (pub.error) throw pub.error;
});

afterAll(async () => {
  await admin.from("custom_domains").delete().eq("domain", domain);
  if (storeId) await admin.from("stores").delete().eq("id", storeId);
  if (owner) await admin.auth.admin.deleteUser(owner.id);
});

describe("Landing pública → pedido", () => {
  it("la landing se muestra con el producto", async () => {
    const res = await fetch(`${BASE}/p/${storeSlug}/faja`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Faja E2E");
    expect(html).toContain("COMPRAR AHORA");
  });

  it("el formulario crea el pedido con el adicional y el precio del servidor", async () => {
    const res = await fetch(`${BASE}/api/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": "190.1.2.3" },
      body: JSON.stringify({
        landing_page_id: landingId,
        offer_id: offerId,
        idempotency_key: `idem-${runId}`,
        first_name: "Cliente",
        last_name: "E2E",
        phone: "987 654 321",
        district_code: "150101",
        address: "Av. Prueba 123",
        reference: "Frente al parque",
        bumps: ["extra"],
        email: "cliente@e2e.pe",
        attribution: { utm_source: "facebook", ttclid: "TT.123" },
      }),
    });
    const json = await res.json();
    expect(res.status, JSON.stringify(json)).toBe(200);
    expect(json.total).toBe(110);
    orderId = json.orderId;
    const { data } = await admin.from("orders").select("subtotal, customer_email, order_attribution (ttclid)").eq("id", orderId).single();
    expect(Number(data?.subtotal)).toBe(110);
    expect(data?.customer_email).toBe("cliente@e2e.pe");
    const attr = Array.isArray(data?.order_attribution) ? data?.order_attribution[0] : data?.order_attribution;
    expect((attr as { ttclid: string } | null)?.ttclid).toBe("TT.123");
  });

  it("provincia sin DNI se rechaza", async () => {
    const res = await fetch(`${BASE}/api/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ landing_page_id: landingId, offer_id: offerId, idempotency_key: `idem2-${runId}`, first_name: "Ana", phone: "912345678", district_code: "040101", address: "Calle 1 de Arequipa" }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/DNI/);
  });

  it("la página de gracias ofrece el upsell y se agrega al mismo pedido", async () => {
    const page = await fetch(`${BASE}/p/${storeSlug}/faja/gracias?pedido=1001&o=${orderId}`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("Segunda faja");
    const res = await fetch(`${BASE}/api/orders/upsell`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order_id: orderId, landing_id: landingId }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).total).toBe(160);
    const again = await fetch(`${BASE}/api/orders/upsell`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ order_id: orderId, landing_id: landingId }) });
    expect(again.status).toBe(400);
  });
});

describe("Abandonados y errores", () => {
  it("el formulario abandonado se guarda", async () => {
    const res = await fetch(`${BASE}/api/abandoned`, {
      method: "POST",
      body: JSON.stringify({ landing_page_id: landingId, session_id: `sess${runId}`, name: "Rosa", phone: "923456789", offer_id: offerId }),
    });
    expect(res.status).toBe(204);
    const { data } = await admin.from("abandoned_checkouts").select("status, phone").eq("store_id", storeId);
    expect(data).toEqual([{ status: "open", phone: "51923456789" }]);
  });

  it("un error del navegador queda registrado", async () => {
    const message = `Error de prueba E2E ${runId}`;
    const res = await fetch(`${BASE}/api/errors`, { method: "POST", body: JSON.stringify({ message, path: `/p/${storeSlug}/faja` }) });
    expect(res.status).toBe(204);
    const { data } = await admin.from("app_errors").select("id, count").eq("message", message);
    expect(data?.[0]?.count).toBe(1);
    await admin.from("app_errors").delete().eq("message", message);
  });
});

describe("Dominio propio", () => {
  it("un dominio activo muestra la landing en dominio/landing", async () => {
    await admin.from("custom_domains").insert({ domain, owner_id: owner.id, store_id: storeId, status: "active" });
    const res = await getWithHost("/faja", domain);
    expect(res.status).toBe(200);
    expect(res.body).toContain("Faja E2E");
    const missing = await getWithHost("/no-existe/x/y", domain);
    expect(missing.status).toBe(404);
    const unknown = await getWithHost("/faja", "otro-dominio-no-registrado.pe");
    expect(unknown.status).toBe(404);
  });
});
