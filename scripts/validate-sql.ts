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
  await step("cambio en lote con motivo", `select public.change_orders_status(array[]::uuid[], 'cancelled', null, 'no_contesta')`);
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
  await step("reactivar tienda", `select public.admin_set_store_status('${storeId}', 'active')`);

  // ── Bloque 1: controlador de pedidos ──
  console.log("\nBloque 1:");
  const o2 = (await step(
    "pedido nuevo (landing) → notificación",
    `select public.create_cod_order('{"landing_page_id":"${landingId}","offer_id":"${offerId}","idempotency_key":"k2","first_name":"Luis","phone":"51911111111","district_code":"040101","address":"Calle 2"}'::jsonb)`,
  )) as { order_id: string };
  await step("zona calculada (provincia)", `select zone from public.orders where id = '${o2.order_id}'`);
  await step("notificación creada", `select title from public.notifications where order_id = '${o2.order_id}' and type = 'new_order'`);
  await step("no leídas", `select public.unread_notifications_count('${storeId}')`);
  await step("intento 1: no contesta", `select public.log_contact_attempt('${o2.order_id}', 'call', 'no_answer')`);
  await step("intento 2: apagado", `select public.log_contact_attempt('${o2.order_id}', 'call', 'phone_off')`);
  await step("intento 3: llamar después", `select public.log_contact_attempt('${o2.order_id}', 'call', 'call_later', 'a las 6', now() + interval '2 hours')`);
  await step("intento 4: no contesta", `select public.log_contact_attempt('${o2.order_id}', 'whatsapp', 'no_answer')`);
  await step("secuencia completa → aviso", `select count(*) from public.notifications where order_id = '${o2.order_id}' and type = 'sequence_done'`);
  await step("cancelar con motivo", `select (public.change_order_status('${o2.order_id}', 'cancelled', 'no responde', 'no_contesta')).cancel_reason`);
  const o3 = (await step(
    "pedido 3",
    `select public.create_cod_order('{"landing_page_id":"${landingId}","offer_id":"${offerId}","idempotency_key":"k3","first_name":"Eva","phone":"51922222222","district_code":"150133","address":"Calle 3"}'::jsonb)`,
  )) as { order_id: string };
  await step("rechazó en la 1ª llamada → cancelado", `select public.log_contact_attempt('${o3.order_id}', 'call', 'rejected', null, null, 'precio') ->> 'status'`);
  await step("motivo guardado", `select cancel_reason from public.orders where id = '${o3.order_id}'`);
  const o4 = (await step(
    "pedido 4",
    `select public.create_cod_order('{"landing_page_id":"${landingId}","offer_id":"${offerId}","idempotency_key":"k4","first_name":"Ana","phone":"51987654321","district_code":"150133","address":"Calle 4"}'::jsonb)`,
  )) as { order_id: string };
  await step("cliente con historial → riesgo", `select risk_reasons from public.orders where id = '${o4.order_id}'`);
  await step("confirmó por WhatsApp", `select public.log_contact_attempt('${o4.order_id}', 'whatsapp', 'confirmed') ->> 'status'`);
  const manual = (await step(
    "pedido manual",
    `select public.create_manual_order('{"store_id":"${storeId}","product_id":"${productId}","quantity":2,"subtotal":"150","first_name":"Rosa","phone":"51933333333","district_code":"150101","address":"Jr. Lima 1","source_channel":"whatsapp","already_confirmed":true}'::jsonb)`,
  )) as { order_id: string };
  await step("pedido manual: origen, estado y total", `select row(source, source_channel, status, total)::text from public.orders where id = '${manual.order_id}'`);
  await step("marcar notificaciones leídas", `select public.mark_notifications_read('${storeId}')`);
  await step("no leídas tras marcar", `select public.unread_notifications_count('${storeId}')`);
  const token = (await step("invitar confirmador", `select public.create_store_invitation('${storeId}', 'confirmador@test.dev')`)) as string;
  await step("ver invitación (pública)", `select public.get_invitation('${token}')`);
  const staffId = (await step("usuario confirmador", "insert into auth.users (email) values ('confirmador@test.dev') returning id")) as string;
  await db.exec(`set request.jwt.claim.sub = '${staffId}'`);
  await step("aceptar invitación", `select public.accept_store_invitation('${token}')`);
  await step("rol del confirmador", `select public.my_store_role('${storeId}')`);
  for (const [label, sql] of [
    ["confirmador no ve gastos", `select public.get_expense_totals('${storeId}', current_date, current_date)`],
    ["confirmador no invita", `select public.create_store_invitation('${storeId}', 'otro@test.dev')`],
    ["confirmador no publica", `select public.publish_landing_page('${landingId}')`],
  ] as const) {
    try {
      await db.query(sql);
      console.error(`  ✗ ${label}: debería fallar`);
      process.exit(1);
    } catch {
      console.log(`  ✓ ${label}`);
    }
  }
  await step("confirmador trabaja pedidos", `select public.assign_orders(array['${manual.order_id}'::uuid], '${staffId}')`);
  await step("confirmador ve el equipo", `select jsonb_array_length(public.get_store_team('${storeId}'))`);
  await db.exec(`set request.jwt.claim.sub = '${userId}'`);
  await step("dueño quita al confirmador", `select public.remove_store_member('${storeId}', '${staffId}')`);
  await step("asignación liberada", `select assigned_to is null from public.orders where id = '${manual.order_id}'`);

  // ── Bloque 2: provincia y despacho ──
  console.log("\nBloque 2:");
  await step("couriers iniciales", `select string_agg(courier_id || ':' || zone, ',' order by courier_id) from public.store_couriers where store_id = '${storeId}'`);
  await step("stock del producto = 5", `update public.products set stock = 5 where id = '${productId}' returning stock`);
  await step("store_settings adelanto 20", `update public.store_settings set advance_amount = 20 where store_id = '${storeId}' returning advance_amount`);
  const lima = (await step(
    "pedido Lima (sin adelanto)",
    `select public.create_cod_order('{"landing_page_id":"${landingId}","offer_id":"${offerId}","idempotency_key":"k5","first_name":"Lima","phone":"51944444444","district_code":"150101","address":"Calle 5"}'::jsonb)`,
  )) as { order_id: string };
  await step("Lima: adelanto 0", `select advance_amount from public.orders where id = '${lima.order_id}'`);
  const prov = (await step(
    "pedido provincia (con adelanto)",
    `select public.create_cod_order('{"landing_page_id":"${landingId}","offer_id":"${offerId}","idempotency_key":"k6","first_name":"Prov","phone":"51955555555","district_code":"040101","address":"Calle 6","dni":"12345678"}'::jsonb)`,
  )) as { order_id: string };
  await step("provincia: adelanto 20", `select advance_amount from public.orders where id = '${prov.order_id}'`);
  await step("confirmar provincia → descuenta stock", `select (public.change_order_status('${prov.order_id}', 'confirmed')).stock_reserved`);
  await step("stock tras confirmar (5 - 2)", `select stock from public.products where id = '${productId}'`);
  await step("courier y costo sugerido", `select courier_id || ' ' || shipping_cost from public.orders where id = '${prov.order_id}'`);
  await step("pago adelanto 30", `insert into public.order_payments (store_id, order_id, kind, amount, method) values ('${storeId}', '${prov.order_id}', 'advance', 30, 'yape') returning id`);
  await step("adelanto sincronizado", `select advance_amount || ' / saldo ' || balance_due from public.orders where id = '${prov.order_id}'`);
  const exp = (await step(
    "exportar a Shalom (reserva atómica)",
    `select public.reserve_orders_for_export('${storeId}', 'shalom', array['${prov.order_id}'::uuid], 'ATOCONGO', true)`,
  )) as { batch_id: string };
  await step("lote creado", `select order_count from public.export_batches where id = '${exp.batch_id}'`);
  try {
    await db.query(`select public.reserve_orders_for_export('${storeId}', 'shalom', array['${prov.order_id}'::uuid])`);
    console.error("  ✗ exportar dos veces: debería fallar");
    process.exit(1);
  } catch {
    console.log("  ✓ no se exporta dos veces");
  }
  await step("provincia: enviado → en agencia", `select (public.change_order_status('${prov.order_id}', 'at_agency')).at_agency_at is not null`);
  await step("provincia: en agencia → cobrado (sin entregar)", `select (public.change_order_status('${prov.order_id}', 'collected')).delivered_at is null`);
  await step("provincia: cobrado → entregado", `select (public.change_order_status('${prov.order_id}', 'delivered')).status`);
  try {
    await db.query(`select public.change_order_status('${lima.order_id}', 'at_agency')`);
    console.error("  ✗ Lima no pasa por agencia: debería fallar");
    process.exit(1);
  } catch {
    console.log("  ✓ Lima no pasa por «En agencia»");
  }
  await step("Lima: confirmar", `select (public.change_order_status('${lima.order_id}', 'confirmed')).status`);
  await step("Lima: enviado", `select (public.change_order_status('${lima.order_id}', 'shipped')).status`);
  await step("Lima: no entregado → devuelve stock", `select (public.change_order_status('${lima.order_id}', 'failed_delivery', null, 'rechazo_en_puerta')).return_shipments`);
  await step("stock final (devuelto)", `select stock from public.products where id = '${productId}'`);
  await step("Lima: devuelto (no devuelve dos veces)", `select (public.change_order_status('${lima.order_id}', 'returned')).stock_reserved`);
  await step("stock sigue igual", `select stock from public.products where id = '${productId}'`);
  await step("stock 1 para probar faltante", `update public.products set stock = 1 where id = '${productId}' returning stock`);
  const o7 = (await step(
    "pedido sin stock suficiente",
    `select public.create_cod_order('{"landing_page_id":"${landingId}","offer_id":"${offerId}","idempotency_key":"k7","first_name":"Sin","phone":"51966666666","district_code":"150101","address":"Calle 7"}'::jsonb)`,
  )) as { order_id: string };
  try {
    await db.query(`select public.change_order_status('${o7.order_id}', 'confirmed')`);
    console.error("  ✗ sin stock: debería fallar");
    process.exit(1);
  } catch (e) {
    console.log(`  ✓ sin stock no confirma → ${(e as Error).message}`);
  }
  await step("aviso de stock bajo", `select count(*) from public.notifications where store_id = '${storeId}' and type = 'low_stock'`);
  await step("get_order_stats con agencia", `select public.get_order_stats('${storeId}', now() - interval '1 day', now() + interval '1 day') -> 'in_progress'`);

  // ── Bloque 3: números correctos ──
  console.log("\nBloque 3:");
  const range = `'${storeId}', now() - interval '1 day', now() + interval '1 day'`;
  await step("venta real por zona (provincia entregada = venta)", `select public.get_order_stats(${range}) -> 'delivered'`);
  await step("venta en provincia cuenta al cobrar", `select public.order_is_sale('collected', 'provincia', null, now(), 'zone')`);
  await step("…pero no si el modo es «entregado»", `select public.order_is_sale('collected', 'provincia', null, now(), 'delivered')`);
  await step("Lima cuenta al entregar", `select public.order_is_sale('delivered', 'lima', now(), null, 'zone')`);
  await step("no entregado con 2 envíos", `select public.order_logistics_cost('failed_delivery', now(), 12, 2::smallint)`);
  await step("modo entregado", `update public.store_settings set real_sale_mode = 'delivered', ad_currency = 'USD', usd_rate = 3.8, apply_igv = true where store_id = '${storeId}' returning real_sale_mode`);
  await step(
    "gasto en USD con IGV → soles",
    `insert into public.expenses (store_id, expense_date, category, amount, currency, exchange_rate, igv_rate, campaign_id) values ('${storeId}', current_date, 'meta_ads', 100, 'USD', 3.8, 0.18, '120200') returning amount_pen`,
  );
  await step("get_expense_totals en soles", `select public.get_expense_totals('${storeId}', current_date - 1, current_date + 1) -> 'ad_spend'`);
  await step("IGV del periodo", `select public.get_expense_totals('${storeId}', current_date - 1, current_date + 1) -> 'igv'`);
  await step("% atribuido", `select public.get_order_stats(${range}) -> 'attributed'`);
  await step("get_campaign_stats", `select jsonb_array_length(public.get_campaign_stats(${range}, current_date - 1, current_date + 1))`);
  await step("get_product_stats", `select public.get_product_stats(${range}, current_date - 1, current_date + 1) -> 0 -> 'ad_spend'`);
  await step("get_geo_stats", `select jsonb_array_length(public.get_geo_stats(${range}, 'department'))`);
  await step("get_funnel", `select public.get_funnel(${range}) -> 'delivered'`);

  // ── Bloque 4: Meta y Rendimiento ──
  console.log("\nBloque 4:");
  await step(
    "entidades de Meta",
    `insert into public.meta_entities (store_id, id, level, name, campaign_id, adset_id) values
      ('${storeId}', '120200', 'campaign', 'Campaña Fajas', null, null),
      ('${storeId}', '120201', 'adset', 'Mujeres 25-45', '120200', null),
      ('${storeId}', '120202', 'ad', 'Video testimonio', '120200', '120201') returning name`,
  );
  await step(
    "métricas diarias",
    `insert into public.meta_insights_daily (store_id, date, ad_id, adset_id, campaign_id, spend, spend_pen, impressions, reach, clicks, results)
     values ('${storeId}', current_date, '120202', '120201', '120200', 20, 89.68, 5000, 4000, 120, 6) returning spend_pen`,
  );
  await step("gasto sincronizado (source meta_sync)", `insert into public.expenses (store_id, expense_date, category, amount, source, import_key, campaign_id) values ('${storeId}', current_date, 'meta_ads', 20, 'meta_sync', 'meta:x', '120200') returning source`);
  for (const level of ["campaign", "adset", "ad", "page"]) {
    await step(`get_performance (${level})`, `select public.get_performance(${range}, current_date - 1, current_date + 1, '${level}') -> 0`);
  }

  // ── Bloque 5: landing y ventas ──
  console.log("\nBloque 5:");
  await step("stock libre", `update public.products set stock = null where id = '${productId}' returning id`);
  await step(
    "landing con order bump, upsell, ángulo y A/B",
    `update public.landing_pages set
       content = jsonb_set(jsonb_set(content, '{form_blocks}', coalesce(content -> 'form_blocks', '[]'::jsonb) || '[{"id":"bmp","type":"form_bumps","title":"Agrega","items":[{"id":"b1","name":"Crema","price":25,"cost":5},{"id":"b2","name":"Gorro","price":15}]}]'::jsonb),
                        '{thank_you_upsell}', '{"enabled":true,"name":"Segunda faja","price":49,"cost":20}'::jsonb),
       settings = jsonb_build_object('angle', 'Dolor de espalda', 'ab', jsonb_build_object('enabled', true, 'variants', jsonb_build_array(jsonb_build_object('landing_id', id, 'weight', 50))))
     where id = '${landingId}' returning settings ->> 'angle'`,
  );
  await step("publicar", `select (public.publish_landing_page('${landingId}')).status`);
  await step("landing pública trae A/B y ángulo", `select public.get_public_landing('smoke-store', 'faja') -> 'landing' -> 'ab_variants'`);
  const withBump = (await step(
    "pedido con bump (precio del servidor, no del navegador)",
    `select public.create_cod_order('{"landing_page_id":"${landingId}","offer_id":"${offerId}","idempotency_key":"k8","first_name":"Bump","phone":"51977777777","district_code":"150101","address":"Calle 8","email":"Ana@Mail.com","bumps":["b1","no-existe"],"price":1}'::jsonb)`,
  )) as { order_id: string };
  await step("subtotal = oferta + bump", `select subtotal || ' / costo ' || product_cost_total || ' / ' || customer_email from public.orders where id = '${withBump.order_id}'`);
  await step("ítems del pedido", `select string_agg(kind || ':' || product_name || ':' || line_price, ', ' order by kind) from public.order_items where order_id = '${withBump.order_id}'`);
  await step("upsell en gracias", `select public.add_order_upsell('${withBump.order_id}', '${landingId}') -> 'total'`);
  try {
    await db.query(`select public.add_order_upsell('${withBump.order_id}', '${landingId}')`);
    console.error("  ✗ upsell dos veces: debería fallar");
    process.exit(1);
  } catch {
    console.log("  ✓ el upsell se agrega una sola vez");
  }
  await step("saldo actualizado", `select total || ' / saldo ' || balance_due from public.orders where id = '${withBump.order_id}'`);
  await step(
    "formulario abandonado",
    `select public.upsert_abandoned_checkout('{"landing_page_id":"${landingId}","session_id":"sess-abandon-1","name":"Rosa","phone":"51988888888","district_code":"040101","offer_id":"${offerId}"}'::jsonb)`,
  );
  await step("abandonado guardado", `select status || ' · ' || province_name from public.abandoned_checkouts where phone = '51988888888'`);
  await step(
    "ese celular hace el pedido",
    `select public.create_cod_order('{"landing_page_id":"${landingId}","offer_id":"${offerId}","idempotency_key":"k9","first_name":"Rosa","phone":"51988888888","district_code":"040101","address":"Calle 9","dni":"11112222"}'::jsonb) -> 'order_number'`,
  );
  await step("abandonado → recuperado", `select status from public.abandoned_checkouts where phone = '51988888888'`);
  await step("rendimiento por ángulo", `select public.get_performance(${range}, current_date - 1, current_date + 1, 'angle') -> 0 -> 'key'`);
  await step("purga de abandonados", `select public.purge_abandoned_checkouts()`);

  // ── Bloque 6: plataforma ──
  console.log("\nBloque 6:");
  const store2 = (await step("segunda tienda del mismo usuario", "select public.create_store('Smoke 2', 'smoke-dos')")) as string;
  await step("tiendas propias", `select count(*) from public.stores where owner_id = '${userId}'`);
  await step(
    "dominio para todas las tiendas",
    `insert into public.custom_domains (domain, owner_id) values ('mitienda.pe', '${userId}') returning domain`,
  );
  await step("dominio de una tienda", `insert into public.custom_domains (domain, owner_id, store_id) values ('fajas.pe', '${userId}', '${store2}') returning domain`);
  await step("pendiente → no resuelve", `select public.resolve_custom_domain('fajas.pe') is null`);
  await step("activar dominios", `update public.custom_domains set status = 'active' returning status`);
  await step("resuelve dominio de tienda", `select public.resolve_custom_domain('FAJAS.pe')`);
  await step("resuelve dominio general", `select public.resolve_custom_domain('mitienda.pe')`);
  await step("el dominio general sirve sus tiendas", `select public.domain_serves_store('mitienda.pe', 'smoke-store')`);
  await step("…y no tiendas ajenas", `select public.domain_serves_store('mitienda.pe', 'otra-tienda')`);
  await step("TikTok configurado", `insert into public.store_tiktok_settings (store_id, pixel_code, enabled) values ('${storeId}', 'C4ABCDEFGHIJ1234', true) returning pixel_code`);
  await step("landing pública trae Pixel de TikTok", `select public.get_public_landing('smoke-store', 'faja') -> 'tiktok'`);
  await step("evento TikTok en la bandeja", `insert into public.marketing_events (store_id, platform, event_name, event_id, event_time) values ('${storeId}', 'tiktok', 'CompletePayment', 'tt_purchase_1', now()) returning platform`);
  await step("registrar error", `select public.log_app_error('{"fingerprint":"abcdef123456","source":"client","message":"Boom","path":"/p/x"}'::jsonb)`);
  await step("mismo error se agrupa", `select public.log_app_error('{"fingerprint":"abcdef123456","source":"client","message":"Boom"}'::jsonb)`);
  await step("conteo agrupado", `select count from public.app_errors where fingerprint = 'abcdef123456'`);
  await step("admin ve errores", `select jsonb_array_length(public.admin_app_errors())`);
  await step("aviso de errores 24h", `select public.admin_error_count()`);
  await step("tutorial oculto", `update public.store_settings set onboarding_dismissed = true where store_id = '${storeId}' returning onboarding_dismissed`);

  // ── Bloque 7: operación y equipo ──
  console.log("\nBloque 7:");
  await step("contadores por estado (en la base)", `select public.order_status_counts('${storeId}')`);
  await step("contadores de logística", `select public.logistics_counts('${storeId}')`);
  await step("contadores de abandonados", `select public.abandoned_status_counts('${storeId}')`);
  await step("color y comisión del dueño", `select public.update_member_settings('${storeId}', '${userId}', '#ff8800', 2, 3)`);
  await step("embalaje S/ 1.5 por unidad", `update public.store_settings set packaging_cost = 1.5 where store_id = '${storeId}' returning packaging_cost`);
  await step("variantes de talla", `update public.products set variant_label = 'Talla', stock = null where id = '${productId}' returning variant_label`);
  const vS = (await step("talla S (stock 5)", `insert into public.product_variants (store_id, product_id, name, stock, position) values ('${storeId}', '${productId}', 'S', 5, 0) returning id`)) as string;
  const vM = (await step("talla M (stock 1)", `insert into public.product_variants (store_id, product_id, name, stock, position) values ('${storeId}', '${productId}', 'M', 1, 1) returning id`)) as string;
  await step("landing pública trae variantes", `select public.get_public_landing('smoke-store', 'faja') -> 'product' -> 'variants'`);
  const o10 = (await step(
    "pedido Lima de 2 unidades",
    `select public.create_cod_order('{"landing_page_id":"${landingId}","offer_id":"${offerId}","idempotency_key":"k10","first_name":"Var","phone":"51955500000","district_code":"150101","address":"Calle 10"}'::jsonb)`,
  )) as { order_id: string };
  try {
    await db.query(`select public.set_order_variants('${o10.order_id}', array['${vS}'::uuid])`);
    console.error("  ✗ 1 variante para 2 unidades: debería fallar");
    process.exit(1);
  } catch {
    console.log("  ✓ pide una variante por unidad");
  }
  await step("elegir S + M", `select public.set_order_variants('${o10.order_id}', array['${vS}'::uuid, '${vM}'::uuid]) -> 'variants'`);
  await step("confirmar → comisión, embalaje y stock por variante", `select row(o.confirmed_by is not null, o.commission_amount, o.packaging_cost)::text from public.change_order_status('${o10.order_id}', 'confirmed') o`);
  await step("stock S y M", `select string_agg(name || '=' || stock, ',' order by position) from public.product_variants where product_id = '${productId}'`);
  try {
    await db.query(`select public.set_order_variants('${o10.order_id}', array['${vM}'::uuid, '${vM}'::uuid])`);
    console.error("  ✗ M agotada: debería fallar");
    process.exit(1);
  } catch (e) {
    console.log(`  ✓ cambiar a M+M sin stock no deja → ${(e as Error).message}`);
  }
  await step("cambiar a S+S (devuelve M)", `select public.set_order_variants('${o10.order_id}', array['${vS}'::uuid, '${vS}'::uuid]) -> 'variants'`);
  await step("stock tras el cambio", `select string_agg(name || '=' || stock, ',' order by position) from public.product_variants where product_id = '${productId}'`);
  await step("enviado y entregado (Lima)", `select (public.change_orders_status(array['${o10.order_id}'::uuid], 'delivered'))`);
  const settle = (await step("liquidar con el courier", `select public.settle_orders('${storeId}', array['${o10.order_id}'::uuid], 'Depósito Eva')`)) as { settlement_id: string };
  await step("pedido pasa a Cobrado", `select status from public.orders where id = '${o10.order_id}'`);
  try {
    await db.query(`select public.settle_orders('${storeId}', array['${o10.order_id}'::uuid])`);
    console.error("  ✗ liquidar dos veces: debería fallar");
    process.exit(1);
  } catch {
    console.log("  ✓ no se liquida dos veces");
  }
  await step("anular liquidación", `select public.undo_settlement('${settle.settlement_id}')`);
  await step("vuelve a Entregado", `select status || ' / ' || coalesce(settled_at::text, 'sin liquidar') from public.orders where id = '${o10.order_id}'`);
  await step("comisiones", `select public.get_commissions('${storeId}') -> 0`);
  await step("pago de comisión", `insert into public.commission_payments (store_id, user_id, amount) values ('${storeId}', '${userId}', 1) returning amount`);
  await step("métricas por confirmador", `select public.get_team_metrics(${range}) -> 0`);
  await step("utilidad con embalaje", `select public.get_order_stats(${range}) -> 'shipping_cost'`);
  await step("rendimiento con embalaje", `select jsonb_array_length(public.get_performance(${range}, current_date - 1, current_date + 1, 'page'))`);
  await step("equipo con color", `select public.get_store_team('${storeId}') -> 0 -> 'color'`);

  console.log("\n— Bloque 8: ventas por día —");
  await step("pedidos y ventas por día", `select public.get_daily_orders(${range}) -> 0`);
  console.log("\nOK — prueba de humo completa");
}

main();
