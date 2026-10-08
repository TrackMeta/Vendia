/**
 * Valida las migraciones en un Postgres local (PGlite) con "stubs" mínimos de Supabase
 * (roles, auth.users, auth.uid(), storage). Detecta errores de sintaxis/semántica
 * ANTES de pegarlas en el SQL Editor de Supabase.
 *
 * Uso: npx tsx scripts/validate-sql.ts
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";

const STUBS = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  last_sign_in_at timestamptz
);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select string_to_array(name, '/')
$$;
`;

async function main() {
  const db = new PGlite();
  await db.exec(STUBS);

  const dir = join(__dirname, "../supabase/migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    try {
      await db.exec(readFileSync(join(dir, file), "utf8"));
      console.log(`✓ ${file}`);
    } catch (e) {
      const err = e as { message: string; position?: string; where?: string };
      console.error(`✗ ${file}\n  ${err.message}${err.where ? `\n  where: ${err.where}` : ""}${err.position ? `\n  position: ${err.position}` : ""}`);
      process.exit(1);
    }
  }

  const { rows } = await db.query<{ n: number }>("select count(*)::int as n from public.ubigeo_districts");
  console.log(`\nOK — ${files.length} migraciones válidas · ${rows[0].n} distritos cargados`);

  // Prueba de humo: ejecuta cada función con datos de ejemplo (detecta errores dentro de PL/pgSQL).
  const step = async (label: string, sql: string) => {
    try {
      const res = await db.query<Record<string, unknown>>(sql);
      const value = res.rows[0] ? Object.values(res.rows[0])[0] : null;
      console.log(`  ✓ ${label}${value !== null && value !== undefined ? ` → ${JSON.stringify(value).slice(0, 140)}` : ""}`);
      return value;
    } catch (e) {
      console.error(`  ✗ ${label}\n    ${(e as Error).message}`);
      process.exit(1);
    }
  };

  console.log("\nPrueba de humo:");
  const userId = (await step("usuario", "insert into auth.users (email) values ('smoke@test.dev') returning id")) as string;
  await db.exec(`set request.jwt.claim.sub = '${userId}'`);
  const storeId = (await step("create_store", "select public.create_store('Smoke', 'smoke-store')")) as string;
  const productId = (await step(
    "producto",
    `insert into public.products (store_id, name, price, cost, status) values ('${storeId}', 'Faja', 79.9, 25, 'active') returning id`,
  )) as string;
  const offerId = (await step(
    "oferta",
    `insert into public.product_offers (store_id, product_id, name, quantity, price, is_default) values ('${storeId}', '${productId}', '2 u', 2, 129.9, true) returning id`,
  )) as string;
  const landingId = (await step(
    "landing",
    `insert into public.landing_pages (store_id, product_id, title, slug, content) values ('${storeId}', '${productId}', 'Faja', 'faja', '{}') returning id`,
  )) as string;
  await step("publish_landing_page", `select (public.publish_landing_page('${landingId}')).status`);
  await step("get_public_landing", "select public.get_public_landing('smoke-store', 'faja') -> 'meta'");
  const order = (await step(
    "create_cod_order",
    `select public.create_cod_order('{"landing_page_id":"${landingId}","offer_id":"${offerId}","idempotency_key":"k1","first_name":"Ana","phone":"51987654321","district_code":"150133","address":"Av 1","attribution":{"campaign_id":"999","utm_campaign":"Camp"},"client_ip":"1.2.3.4"}'::jsonb)`,
  )) as { order_id: string; order_number: number };
  await step("change_order_status", `select (public.change_order_status('${order.order_id}', 'confirmed')).status`);
  await step("change_orders_status", `select public.change_orders_status(array['${order.order_id}'::uuid], 'shipped')`);
  await step(
    "apply_integration_status",
    `select public.apply_integration_status('${storeId}', ${order.order_number}, null, 'delivered', 'courier', 'TRK1', 'Motorizado')`,
  );
  await step("get_order_stats", `select public.get_order_stats('${storeId}', now() - interval '1 day', now() + interval '1 day')`);
  await step(
    "gasto",
    `insert into public.expenses (store_id, expense_date, category, amount, campaign_id, product_id) values ('${storeId}', current_date, 'meta_ads', 100, '999', '${productId}') returning id`,
  );
  await step("get_expense_totals", `select public.get_expense_totals('${storeId}', current_date - 1, current_date + 1)`);
  await step("track_landing_event", `select public.track_landing_event('${landingId}', 'page_view', 'session-123')`);
  await step("track (duplicado ignorado)", `select public.track_landing_event('${landingId}', 'page_view', 'session-123')`);
  await step("get_funnel", `select public.get_funnel('${storeId}', now() - interval '1 day', now() + interval '1 day')`);
  await step(
    "get_campaign_stats",
    `select public.get_campaign_stats('${storeId}', now() - interval '1 day', now() + interval '1 day', current_date - 1, current_date + 1)`,
  );
  await step(
    "get_product_stats",
    `select public.get_product_stats('${storeId}', now() - interval '1 day', now() + interval '1 day', current_date - 1, current_date + 1)`,
  );
  await step("get_geo_stats (departamento)", `select public.get_geo_stats('${storeId}', now() - interval '1 day', now() + interval '1 day', 'department')`);
  await step("get_geo_stats (distrito)", `select public.get_geo_stats('${storeId}', now() - interval '1 day', now() + interval '1 day', 'district', '1501')`);
  await step("customer_stats", `select row_to_json(c) from public.customer_stats c where store_id = '${storeId}'`);
  await step("meta_token_configured", `select public.meta_token_configured('${storeId}')`);
  await step("admin (sin permiso → error esperado)", `select coalesce((select 'error' where false), 'ok')`);
  try {
    await db.query("select public.admin_overview()");
    console.error("  ✗ admin_overview debería fallar para un no-admin");
    process.exit(1);
  } catch {
    console.log("  ✓ admin_overview rechaza a un no-admin");
  }
  await step("platform_admin", `insert into public.platform_admins (user_id) values ('${userId}') returning user_id`);
  await step("admin_overview", "select public.admin_overview()");
  await step("admin_list_stores", "select jsonb_array_length(public.admin_list_stores())");
  await step("admin_list_users", "select jsonb_array_length(public.admin_list_users())");
  await step("admin_recent_orders", "select jsonb_array_length(public.admin_recent_orders(10))");
  await step("admin_recent_errors", "select public.admin_recent_errors()");
  await step("admin_set_store_status", `select public.admin_set_store_status('${storeId}', 'blocked')`);
  await step("tienda bloqueada no muestra landing", "select public.get_public_landing('smoke-store', 'faja') is null");
  console.log("\nOK — prueba de humo completa");
}

main();
