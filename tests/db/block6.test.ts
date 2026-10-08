/**
 * Bloque 6 — Plataforma: varias tiendas, dominios propios, TikTok y registro de errores.
 * Ejecutar: npm run test:db
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

config({ path: ".env.local", quiet: true });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const admin = createClient(url, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
const anon = createClient(url, publishable, { auth: { persistSession: false } });
const runId = `${Date.now().toString(36)}b6`;

type User = { id: string; client: SupabaseClient };
async function createUser(label: string): Promise<User> {
  const email = `vendia-test-${label}-${runId}@example.com`;
  const password = `Test-${runId}-${label}-Pass!`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const client = createClient(url, publishable, { auth: { persistSession: false, autoRefreshToken: false } });
  await client.auth.signInWithPassword({ email, password });
  return { id: data.user.id, client };
}

let owner: User;
let stranger: User;
const stores: string[] = [];
const domainOne = `una-${runId}.vendia-test.pe`;
const domainAll = `todas-${runId}.vendia-test.pe`;

beforeAll(async () => {
  owner = await createUser("owner");
  stranger = await createUser("stranger");
});

afterAll(async () => {
  await admin.from("custom_domains").delete().in("domain", [domainOne, domainAll]);
  for (const id of stores) await admin.from("stores").delete().eq("id", id);
  for (const u of [owner, stranger]) if (u) await admin.auth.admin.deleteUser(u.id);
});

describe("Varias tiendas por usuario", () => {
  it("un usuario crea varias tiendas y es dueño de cada una", async () => {
    for (const n of [1, 2]) {
      const { data, error } = await owner.client.rpc("create_store", { p_name: `Tienda ${n}`, p_slug: `b6-${n}-${runId}` });
      expect(error).toBeNull();
      stores.push(data as string);
    }
    const { data } = await owner.client.from("store_members").select("store_id, role").eq("user_id", owner.id);
    expect(data?.map((m) => m.role)).toEqual(["owner", "owner"]);
    // Cada tienda trae sus couriers
    const { data: couriers } = await owner.client.from("store_couriers").select("store_id").in("store_id", stores);
    expect(couriers).toHaveLength(4);
  });
});

describe("Dominios propios", () => {
  it("solo el dueño agrega dominios a sus tiendas; pendiente no resuelve", async () => {
    expect((await owner.client.from("custom_domains").insert({ domain: domainOne, owner_id: owner.id, store_id: stores[0] })).error).toBeNull();
    expect((await owner.client.from("custom_domains").insert({ domain: domainAll, owner_id: owner.id, store_id: null })).error).toBeNull();
    // Otro usuario no puede usar la tienda ajena ni ver los dominios
    expect((await stranger.client.from("custom_domains").insert({ domain: `x-${domainOne}`, owner_id: stranger.id, store_id: stores[0] })).error).not.toBeNull();
    expect((await stranger.client.from("custom_domains").select("id")).data).toEqual([]);
    // El estado lo pone el servidor
    await owner.client.from("custom_domains").update({ status: "active" }).eq("domain", domainOne);
    expect((await anon.rpc("resolve_custom_domain", { p_domain: domainOne })).data).toBeNull();
  });

  it("activo: resuelve la tienda, y el dominio general solo sirve tiendas del dueño", async () => {
    await admin.from("custom_domains").update({ status: "active" }).in("domain", [domainOne, domainAll]);
    expect((await anon.rpc("resolve_custom_domain", { p_domain: domainOne.toUpperCase() })).data).toEqual({ store_slug: `b6-1-${runId}`, all_stores: false });
    expect((await anon.rpc("resolve_custom_domain", { p_domain: domainAll })).data).toEqual({ store_slug: null, all_stores: true });
    expect((await anon.rpc("domain_serves_store", { p_domain: domainAll, p_store_slug: `b6-2-${runId}` })).data).toBe(true);
    expect((await anon.rpc("domain_serves_store", { p_domain: domainAll, p_store_slug: "tienda-demo" })).data).toBe(false);
  });
});

describe("TikTok", () => {
  it("el token no se puede leer desde el cliente; la landing pública trae el Pixel", async () => {
    await admin.from("store_tiktok_settings").insert({ store_id: stores[0], pixel_code: "C4ABCDEFGH123456", access_token_encrypted: "cifrado", enabled: true });
    expect((await owner.client.from("store_tiktok_settings").select("access_token_encrypted").eq("store_id", stores[0])).error).not.toBeNull();
    expect((await owner.client.from("store_tiktok_settings").select("pixel_code").eq("store_id", stores[0])).data).toEqual([{ pixel_code: "C4ABCDEFGH123456" }]);
    expect((await owner.client.rpc("tiktok_token_configured", { p_store_id: stores[0] })).data).toBe(true);
    expect((await stranger.client.rpc("tiktok_token_configured", { p_store_id: stores[0] })).data).toBe(false);
  });
});

describe("Registro de errores", () => {
  it("solo el servidor escribe y solo los administradores de Vendia leen", async () => {
    const fp = `fp${runId}`;
    expect((await owner.client.rpc("log_app_error", { p: { fingerprint: fp, message: "x" } })).error).not.toBeNull();
    await admin.rpc("log_app_error", { p: { fingerprint: fp, source: "client", message: "Boom" } });
    await admin.rpc("log_app_error", { p: { fingerprint: fp, source: "client", message: "Boom" } });
    const { data } = await admin.from("app_errors").select("count").eq("fingerprint", fp).single();
    expect(data?.count).toBe(2);
    expect((await owner.client.rpc("admin_app_errors", { p_include_resolved: false })).error).not.toBeNull();
    expect((await owner.client.from("app_errors").select("id")).data ?? []).toEqual([]);
    await admin.from("app_errors").delete().eq("fingerprint", fp);
  });
});
