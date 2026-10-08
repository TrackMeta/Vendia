-- =====================================================================
-- Vendia — Actualización: Gastos, Meta (Pixel + CAPI), Logística, Analítica y Admin
-- Pegar en Supabase → SQL Editor → Run. Ejecutar UNA sola vez, después de setup-completo.sql.
-- Validado localmente con scripts/validate-sql.ts (PGlite + prueba de humo).
-- =====================================================================

-- >>> supabase/migrations/20261008000700_expenses.sql
-- =====================================================================
-- Vendia — Gastos
-- Regla de utilidad (sin doble conteo):
--   · El costo de producto y de envío se toma de CADA PEDIDO (snapshot).
--   · Las categorías 'product', 'courier' y 'shipping' se registran como
--     referencia de caja y NO se restan otra vez en la utilidad.
--   · Gasto publicitario = meta_ads + tiktok_ads + google_ads.
--   · Otros gastos = todas las demás categorías.
-- =====================================================================

create type public.expense_category as enum (
  'meta_ads',
  'tiktok_ads',
  'google_ads',
  'product',
  'courier',
  'shipping',
  'returns',
  'releasit',
  'whatsapp',
  'software',
  'commissions',
  'other'
);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  expense_date date not null,
  category public.expense_category not null,
  description text check (description is null or char_length(description) <= 300),
  amount numeric(12, 2) not null check (amount >= 0 and amount <= 10000000),
  currency char(3) not null default 'PEN' check (currency = 'PEN'),
  -- ID de campaña de la plataforma (ej: Meta campaign_id) para CPA por campaña
  campaign_id text check (campaign_id is null or char_length(campaign_id) <= 64),
  campaign_name text check (campaign_name is null or char_length(campaign_name) <= 255),
  product_id uuid,
  source text not null default 'manual' check (source in ('manual', 'import')),
  -- Evita duplicar filas al reimportar el mismo reporte
  import_key text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (product_id, store_id) references public.products (id, store_id) on delete set null (product_id),
  unique (store_id, import_key)
);
create index expenses_store_date_idx on public.expenses (store_id, expense_date desc);
create index expenses_campaign_idx on public.expenses (store_id, campaign_id);
create index expenses_product_idx on public.expenses (store_id, product_id);

create trigger expenses_updated_at before update on public.expenses
  for each row execute function public.set_updated_at();

alter table public.expenses enable row level security;
revoke all on public.expenses from anon, authenticated;
grant select, insert, update, delete on public.expenses to authenticated;

create policy "expenses: miembros leen" on public.expenses
  for select to authenticated using (public.is_store_member(store_id));
create policy "expenses: miembros crean" on public.expenses
  for insert to authenticated with check (public.is_store_member(store_id));
create policy "expenses: miembros editan" on public.expenses
  for update to authenticated using (public.is_store_member(store_id)) with check (public.is_store_member(store_id));
create policy "expenses: miembros eliminan" on public.expenses
  for delete to authenticated using (public.is_store_member(store_id));

-- Totales de gastos por rango de fechas (fechas calendario de Lima, ambos inclusive).
create or replace function public.get_expense_totals(p_store_id uuid, p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_store_member(p_store_id) then
    raise exception 'Sin acceso' using errcode = '42501';
  end if;
  return (
    select jsonb_build_object(
      'ad_spend', coalesce(sum(e.amount) filter (where e.category in ('meta_ads', 'tiktok_ads', 'google_ads')), 0),
      'meta_spend', coalesce(sum(e.amount) filter (where e.category = 'meta_ads'), 0),
      'other_expenses', coalesce(sum(e.amount) filter (where e.category not in ('meta_ads', 'tiktok_ads', 'google_ads', 'product', 'courier', 'shipping')), 0),
      'reference_only', coalesce(sum(e.amount) filter (where e.category in ('product', 'courier', 'shipping')), 0),
      'by_category', coalesce((
        select jsonb_object_agg(c.category, c.total)
        from (
          select x.category, sum(x.amount) as total
          from public.expenses x
          where x.store_id = p_store_id and x.expense_date between p_from and p_to
          group by x.category
        ) c
      ), '{}'::jsonb)
    )
    from public.expenses e
    where e.store_id = p_store_id and e.expense_date between p_from and p_to
  );
end;
$$;
grant execute on function public.get_expense_totals(uuid, date, date) to authenticated;

-- >>> supabase/migrations/20261008000800_meta.sql
-- =====================================================================
-- Vendia — Meta Pixel + Conversions API
-- · Pixel ID: público (se usa en la landing).
-- · Token de CAPI: cifrado (AES-256-GCM en la app) y NUNCA legible desde el cliente.
-- · marketing_events: bandeja de salida con event_id único (deduplicación + reintentos).
-- =====================================================================

create table public.store_meta_settings (
  store_id uuid primary key references public.stores (id) on delete cascade,
  pixel_id text check (pixel_id is null or pixel_id ~ '^[0-9]{5,20}$'),
  capi_token_encrypted text,
  test_event_code text check (test_event_code is null or char_length(test_event_code) <= 40),
  enabled boolean not null default false,
  send_lead boolean not null default true,
  send_purchase boolean not null default true,
  updated_at timestamptz not null default now()
);
create trigger store_meta_settings_updated_at before update on public.store_meta_settings
  for each row execute function public.set_updated_at();

alter table public.store_meta_settings enable row level security;
revoke all on public.store_meta_settings from anon, authenticated;
-- El token se puede ESCRIBIR pero no LEER desde el cliente.
grant select (store_id, pixel_id, test_event_code, enabled, send_lead, send_purchase, updated_at)
  on public.store_meta_settings to authenticated;
grant insert (store_id, pixel_id, capi_token_encrypted, test_event_code, enabled, send_lead, send_purchase)
  on public.store_meta_settings to authenticated;
grant update (pixel_id, capi_token_encrypted, test_event_code, enabled, send_lead, send_purchase)
  on public.store_meta_settings to authenticated;

create policy "meta_settings: miembros leen" on public.store_meta_settings
  for select to authenticated using (public.is_store_member(store_id));
create policy "meta_settings: miembros crean" on public.store_meta_settings
  for insert to authenticated with check (public.is_store_member(store_id));
create policy "meta_settings: miembros editan" on public.store_meta_settings
  for update to authenticated using (public.is_store_member(store_id)) with check (public.is_store_member(store_id));

-- ¿La tienda tiene token configurado? (sin exponerlo)
create or replace function public.meta_token_configured(p_store_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_store_member(p_store_id) and exists (
    select 1 from public.store_meta_settings s
    where s.store_id = p_store_id and s.capi_token_encrypted is not null
  );
$$;
grant execute on function public.meta_token_configured(uuid) to authenticated;

create type public.marketing_event_status as enum ('pending', 'sent', 'failed', 'skipped');

create table public.marketing_events (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  order_id uuid,
  platform text not null default 'meta' check (platform in ('meta')),
  event_name text not null check (event_name in ('PageView', 'ViewContent', 'InitiateCheckout', 'Lead', 'Purchase')),
  event_id text not null check (char_length(event_id) between 3 and 100),
  event_time timestamptz not null,
  action_source text not null default 'website',
  payload jsonb not null default '{}'::jsonb,
  status public.marketing_event_status not null default 'pending',
  attempts integer not null default 0,
  last_error text,
  response jsonb,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (order_id, store_id) references public.orders (id, store_id) on delete cascade,
  -- Un mismo evento (ej: purchase_<orderId>) NUNCA se registra dos veces
  unique (store_id, platform, event_id)
);
create index marketing_events_store_idx on public.marketing_events (store_id, created_at desc);
create index marketing_events_retry_idx on public.marketing_events (status, attempts, created_at)
  where status in ('pending', 'failed');
create trigger marketing_events_updated_at before update on public.marketing_events
  for each row execute function public.set_updated_at();

alter table public.marketing_events enable row level security;
revoke all on public.marketing_events from anon, authenticated;
grant select on public.marketing_events to authenticated;
create policy "marketing_events: miembros leen" on public.marketing_events
  for select to authenticated using (public.is_store_member(store_id));
-- Inserción/actualización: solo el servidor (service role).

-- ---------------------------------------------------------------------
-- La landing pública ahora también devuelve el Pixel ID (si Meta está activo).
-- ---------------------------------------------------------------------
create or replace function public.get_public_landing(p_store_slug text, p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'landing', jsonb_build_object(
      'id', l.id,
      'slug', l.slug,
      'title', l.title,
      'content', l.published_content,
      'settings', l.settings,
      'published_at', l.published_at
    ),
    'store', jsonb_build_object(
      'id', s.id,
      'slug', s.slug,
      'name', s.name,
      'currency', s.currency,
      'whatsapp', ss.whatsapp,
      'logo_path', ss.logo_path,
      'favicon_path', ss.favicon_path,
      'shipping_lima', ss.shipping_lima,
      'shipping_province', ss.shipping_province,
      'advance_amount', ss.advance_amount,
      'payment_methods', to_jsonb(ss.payment_methods),
      'confirmation_message', ss.confirmation_message
    ),
    'meta', jsonb_build_object(
      'pixel_id', case when ms.enabled then ms.pixel_id else null end
    ),
    'product', jsonb_build_object(
      'id', p.id,
      'name', p.name,
      'description', p.description,
      'price', p.price,
      'compare_at_price', p.compare_at_price,
      'images', coalesce((
        select jsonb_agg(jsonb_build_object('path', i.storage_path, 'width', i.width, 'height', i.height)
                         order by i.is_primary desc, i.position)
        from public.product_images i where i.product_id = p.id
      ), '[]'::jsonb)
    ),
    'offers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id,
        'name', o.name,
        'quantity', o.quantity,
        'price', o.price,
        'compare_at_price', o.compare_at_price,
        'badge', o.badge,
        'image_path', o.image_path,
        'is_default', o.is_default
      ) order by o.position, o.quantity)
      from public.product_offers o
      where o.product_id = p.id and o.is_active
    ), '[]'::jsonb)
  )
  from public.landing_pages l
  join public.stores s on s.id = l.store_id
  join public.store_settings ss on ss.store_id = s.id
  left join public.store_meta_settings ms on ms.store_id = s.id
  join public.products p on p.id = l.product_id
  where s.slug = lower(p_store_slug)
    and l.slug = lower(p_slug)
    and l.status = 'published'
    and s.status = 'active'
    and p.status = 'active';
$$;
grant execute on function public.get_public_landing(text, text) to anon, authenticated;

-- >>> supabase/migrations/20261008000900_logistics.sql
-- =====================================================================
-- Vendia — Logística, integraciones y webhooks
-- Vendia es la fuente de verdad de los pedidos. Las integraciones
-- (couriers, automatizaciones) solo ACTUALIZAN estados vía webhook firmado.
-- =====================================================================

-- Datos de envío en el pedido
alter table public.orders
  add column courier_name text check (courier_name is null or char_length(courier_name) <= 80),
  add column tracking_code text check (tracking_code is null or char_length(tracking_code) <= 120),
  add column external_order_id text check (external_order_id is null or char_length(external_order_id) <= 120),
  add column integration_status text check (integration_status is null or char_length(integration_status) <= 60),
  add column integration_updated_at timestamptz;

grant update (courier_name, tracking_code) on public.orders to authenticated;
create index orders_external_idx on public.orders (store_id, external_order_id) where external_order_id is not null;

-- ---------------------------------------------------------------------
-- Integraciones por tienda
-- ---------------------------------------------------------------------
create table public.integrations (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  provider text not null check (provider ~ '^[a-z0-9_]{2,40}$'),
  status text not null default 'active' check (status in ('active', 'disabled')),
  config jsonb not null default '{}'::jsonb,
  -- Secretos (API keys del courier) cifrados por la app
  secret_encrypted text,
  -- Secreto para verificar la firma HMAC de los webhooks entrantes (cifrado)
  webhook_secret_encrypted text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, provider)
);
create trigger integrations_updated_at before update on public.integrations
  for each row execute function public.set_updated_at();

alter table public.integrations enable row level security;
revoke all on public.integrations from anon, authenticated;
grant select (id, store_id, provider, status, config, created_at, updated_at) on public.integrations to authenticated;
create policy "integrations: miembros leen" on public.integrations
  for select to authenticated using (public.is_store_member(store_id));
-- Crear/editar/rotar secretos: solo el servidor (service role), tras validar la sesión.

create table public.integration_logs (
  id bigint generated always as identity primary key,
  store_id uuid references public.stores (id) on delete cascade,
  provider text not null,
  direction text not null check (direction in ('inbound', 'outbound')),
  operation text not null,
  order_id uuid,
  success boolean not null,
  status_code integer,
  message text,
  details jsonb,
  created_at timestamptz not null default now()
);
create index integration_logs_store_idx on public.integration_logs (store_id, created_at desc);
create index integration_logs_errors_idx on public.integration_logs (created_at desc) where not success;

alter table public.integration_logs enable row level security;
revoke all on public.integration_logs from anon, authenticated;
grant select on public.integration_logs to authenticated;
create policy "integration_logs: miembros leen" on public.integration_logs
  for select to authenticated using (store_id is not null and public.is_store_member(store_id));

create table public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  store_id uuid references public.stores (id) on delete cascade,
  external_event_id text not null check (char_length(external_event_id) between 1 and 200),
  signature_valid boolean not null,
  payload jsonb not null,
  processed_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  -- Idempotencia: el mismo evento del proveedor se procesa una sola vez
  unique (provider, store_id, external_event_id)
);
create index webhook_events_store_idx on public.webhook_events (store_id, created_at desc);

alter table public.webhook_events enable row level security;
revoke all on public.webhook_events from anon, authenticated;
grant select (id, provider, store_id, external_event_id, signature_valid, processed_at, error, created_at)
  on public.webhook_events to authenticated;
create policy "webhook_events: miembros leen" on public.webhook_events
  for select to authenticated using (store_id is not null and public.is_store_member(store_id));

-- ---------------------------------------------------------------------
-- Cambio de estado desde una integración (solo service role).
-- Busca el pedido por número o por ID externo dentro de la tienda.
-- Si el pedido ya está en ese estado, no hace nada (idempotente).
-- ---------------------------------------------------------------------
create or replace function public.apply_integration_status(
  p_store_id uuid,
  p_order_number integer,
  p_external_order_id text,
  p_to public.order_status,
  p_note text,
  p_tracking_code text default null,
  p_courier_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
begin
  select * into v_order from public.orders o
  where o.store_id = p_store_id
    and ((p_order_number is not null and o.order_number = p_order_number)
      or (p_external_order_id is not null and o.external_order_id = p_external_order_id))
  limit 1;
  if not found then
    raise exception 'Pedido no encontrado' using errcode = 'P0002';
  end if;

  update public.orders set
    tracking_code = coalesce(p_tracking_code, tracking_code),
    courier_name = coalesce(p_courier_name, courier_name),
    integration_status = p_to::text,
    integration_updated_at = now()
  where id = v_order.id;

  if v_order.status = p_to then
    return jsonb_build_object('order_id', v_order.id, 'changed', false);
  end if;

  perform public.apply_order_status(v_order.id, p_to, 'integration', null, p_note);
  return jsonb_build_object('order_id', v_order.id, 'changed', true);
end;
$$;
revoke all on function public.apply_integration_status(uuid, integer, text, public.order_status, text, text, text) from public, anon, authenticated;
grant execute on function public.apply_integration_status(uuid, integer, text, public.order_status, text, text, text) to service_role;

-- Cambio de estado en lote desde el panel (por ejemplo, marcar 20 pedidos como Enviado)
create or replace function public.change_orders_status(p_order_ids uuid[], p_to public.order_status, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_ok integer := 0;
  v_failed integer := 0;
begin
  if array_length(p_order_ids, 1) > 200 then
    raise exception 'Máximo 200 pedidos por vez' using errcode = 'P0001';
  end if;
  foreach v_id in array p_order_ids loop
    begin
      perform public.change_order_status(v_id, p_to, p_note);
      v_ok := v_ok + 1;
    exception when others then
      v_failed := v_failed + 1;
    end;
  end loop;
  return jsonb_build_object('updated', v_ok, 'failed', v_failed);
end;
$$;
grant execute on function public.change_orders_status(uuid[], public.order_status, text) to authenticated;

-- >>> supabase/migrations/20261008001000_analytics.sql
-- =====================================================================
-- Vendia — Analítica: funnel, campañas, productos, geografía.
-- Conteos en SQL; los cálculos derivados (CPA, ROAS, utilidad) se hacen
-- SIEMPRE en src/modules/metrics para que sean iguales en todas las páginas.
-- Definición de venta real: delivered_at no nulo y no terminó en no entregado/devuelto.
-- =====================================================================

create table public.page_events (
  id bigint generated always as identity primary key,
  store_id uuid not null references public.stores (id) on delete cascade,
  landing_page_id uuid not null,
  product_id uuid,
  event_name text not null check (event_name in ('page_view', 'view_content', 'initiate_checkout')),
  session_id text not null check (char_length(session_id) between 8 and 64),
  utm_source text,
  utm_campaign text,
  campaign_id text,
  event_date date not null default ((now() at time zone 'America/Lima')::date),
  created_at timestamptz not null default now(),
  foreign key (landing_page_id, store_id) references public.landing_pages (id, store_id) on delete cascade,
  -- Visitantes únicos: un evento por sesión, landing y día
  unique (landing_page_id, session_id, event_name, event_date)
);
create index page_events_store_idx on public.page_events (store_id, created_at);
create index page_events_product_idx on public.page_events (store_id, product_id, event_name);

alter table public.page_events enable row level security;
revoke all on public.page_events from anon, authenticated;
grant select on public.page_events to authenticated;
create policy "page_events: miembros leen" on public.page_events
  for select to authenticated using (public.is_store_member(store_id));

-- Registro desde el servidor (/api/track). Solo landings publicadas.
create or replace function public.track_landing_event(
  p_landing_id uuid,
  p_event text,
  p_session text,
  p_utm_source text default null,
  p_utm_campaign text default null,
  p_campaign_id text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_landing public.landing_pages;
begin
  select l.* into v_landing from public.landing_pages l
  join public.stores s on s.id = l.store_id
  where l.id = p_landing_id and l.status = 'published' and s.status = 'active';
  if not found then
    return;
  end if;
  insert into public.page_events (store_id, landing_page_id, product_id, event_name, session_id, utm_source, utm_campaign, campaign_id)
  values (v_landing.store_id, v_landing.id, v_landing.product_id, p_event, p_session,
          left(p_utm_source, 255), left(p_utm_campaign, 255), left(p_campaign_id, 64))
  on conflict do nothing;
end;
$$;
revoke all on function public.track_landing_event(uuid, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.track_landing_event(uuid, text, text, text, text, text) to service_role;

-- ---------------------------------------------------------------------
-- Funnel
-- ---------------------------------------------------------------------
create or replace function public.get_funnel(p_store_id uuid, p_from timestamptz, p_to timestamptz, p_landing_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_store_member(p_store_id) then
    raise exception 'Sin acceso' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'visits', (select count(distinct (e.session_id, e.landing_page_id)) from public.page_events e
               where e.store_id = p_store_id and e.event_name = 'page_view' and e.created_at >= p_from and e.created_at < p_to
                 and (p_landing_id is null or e.landing_page_id = p_landing_id)),
    'view_content', (select count(distinct (e.session_id, e.landing_page_id)) from public.page_events e
               where e.store_id = p_store_id and e.event_name = 'view_content' and e.created_at >= p_from and e.created_at < p_to
                 and (p_landing_id is null or e.landing_page_id = p_landing_id)),
    'initiate_checkout', (select count(distinct (e.session_id, e.landing_page_id)) from public.page_events e
               where e.store_id = p_store_id and e.event_name = 'initiate_checkout' and e.created_at >= p_from and e.created_at < p_to
                 and (p_landing_id is null or e.landing_page_id = p_landing_id)),
    'orders', (select count(*) from public.orders o where o.store_id = p_store_id and o.created_at >= p_from and o.created_at < p_to
                 and (p_landing_id is null or o.landing_page_id = p_landing_id)),
    'confirmed', (select count(*) from public.orders o where o.store_id = p_store_id and o.created_at >= p_from and o.created_at < p_to
                 and o.confirmed_at is not null and (p_landing_id is null or o.landing_page_id = p_landing_id)),
    'shipped', (select count(*) from public.orders o where o.store_id = p_store_id and o.created_at >= p_from and o.created_at < p_to
                 and o.shipped_at is not null and (p_landing_id is null or o.landing_page_id = p_landing_id)),
    'delivered', (select count(*) from public.orders o where o.store_id = p_store_id and o.created_at >= p_from and o.created_at < p_to
                 and o.delivered_at is not null and o.status not in ('failed_delivery', 'returned')
                 and (p_landing_id is null or o.landing_page_id = p_landing_id)),
    'collected', (select count(*) from public.orders o where o.store_id = p_store_id and o.created_at >= p_from and o.created_at < p_to
                 and o.collected_at is not null and (p_landing_id is null or o.landing_page_id = p_landing_id))
  );
end;
$$;
grant execute on function public.get_funnel(uuid, timestamptz, timestamptz, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Campañas: pedidos por campaña (campaign_id > utm_campaign > directo) + gasto por campaign_id
-- ---------------------------------------------------------------------
create or replace function public.get_campaign_stats(
  p_store_id uuid, p_from timestamptz, p_to timestamptz, p_from_date date, p_to_date date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_store_member(p_store_id) then
    raise exception 'Sin acceso' using errcode = '42501';
  end if;
  return coalesce((
    with o as (
      select
        coalesce(nullif(a.campaign_id, ''), nullif(a.utm_campaign, ''), '(directo)') as campaign_key,
        nullif(a.campaign_id, '') as campaign_id,
        a.utm_campaign,
        a.utm_source,
        ord.*
      from public.orders ord
      left join public.order_attribution a on a.order_id = ord.id
      where ord.store_id = p_store_id and ord.created_at >= p_from and ord.created_at < p_to
    ),
    agg as (
      select
        campaign_key,
        max(campaign_id) as campaign_id,
        max(utm_campaign) as campaign_name,
        max(utm_source) as source,
        count(*) as orders,
        count(*) filter (where confirmed_at is not null) as confirmed,
        count(*) filter (where shipped_at is not null) as shipped,
        count(*) filter (where delivered_at is not null and status not in ('failed_delivery', 'returned')) as delivered,
        count(*) filter (where status = 'cancelled') as cancelled,
        coalesce(sum(total), 0) as orders_value,
        coalesce(sum(total) filter (where delivered_at is not null and status not in ('failed_delivery', 'returned')), 0) as revenue,
        coalesce(sum(product_cost_total) filter (where delivered_at is not null and status not in ('failed_delivery', 'returned')), 0) as product_cost,
        coalesce(sum(shipping_cost) filter (where shipped_at is not null), 0) as shipping_cost
      from o
      group by campaign_key
    ),
    spend as (
      select e.campaign_id as campaign_key, sum(e.amount) as ad_spend, max(e.campaign_name) as campaign_name
      from public.expenses e
      where e.store_id = p_store_id and e.campaign_id is not null
        and e.category in ('meta_ads', 'tiktok_ads', 'google_ads')
        and e.expense_date between p_from_date and p_to_date
      group by e.campaign_id
    )
    select jsonb_agg(jsonb_build_object(
      'campaign_key', coalesce(agg.campaign_key, spend.campaign_key),
      'campaign_id', coalesce(agg.campaign_id, spend.campaign_key),
      'campaign_name', coalesce(agg.campaign_name, spend.campaign_name),
      'source', agg.source,
      'orders', coalesce(agg.orders, 0),
      'confirmed', coalesce(agg.confirmed, 0),
      'shipped', coalesce(agg.shipped, 0),
      'delivered', coalesce(agg.delivered, 0),
      'cancelled', coalesce(agg.cancelled, 0),
      'orders_value', coalesce(agg.orders_value, 0),
      'revenue', coalesce(agg.revenue, 0),
      'product_cost', coalesce(agg.product_cost, 0),
      'shipping_cost', coalesce(agg.shipping_cost, 0),
      'ad_spend', coalesce(spend.ad_spend, 0)
    ) order by coalesce(spend.ad_spend, 0) desc, coalesce(agg.orders, 0) desc)
    from agg
    full outer join spend on spend.campaign_key = agg.campaign_key
  ), '[]'::jsonb);
end;
$$;
grant execute on function public.get_campaign_stats(uuid, timestamptz, timestamptz, date, date) to authenticated;

-- ---------------------------------------------------------------------
-- Productos
-- ---------------------------------------------------------------------
create or replace function public.get_product_stats(
  p_store_id uuid, p_from timestamptz, p_to timestamptz, p_from_date date, p_to_date date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_store_member(p_store_id) then
    raise exception 'Sin acceso' using errcode = '42501';
  end if;
  return coalesce((
    with items as (
      select distinct on (ord.id) ord.*, oi.product_id
      from public.orders ord
      join public.order_items oi on oi.order_id = ord.id
      where ord.store_id = p_store_id and ord.created_at >= p_from and ord.created_at < p_to
      order by ord.id, oi.created_at
    ),
    agg as (
      select
        product_id,
        count(*) as orders,
        count(*) filter (where confirmed_at is not null) as confirmed,
        count(*) filter (where shipped_at is not null) as shipped,
        count(*) filter (where delivered_at is not null and status not in ('failed_delivery', 'returned')) as delivered,
        coalesce(sum(total), 0) as orders_value,
        coalesce(sum(total) filter (where delivered_at is not null and status not in ('failed_delivery', 'returned')), 0) as revenue,
        coalesce(sum(product_cost_total) filter (where delivered_at is not null and status not in ('failed_delivery', 'returned')), 0) as product_cost,
        coalesce(sum(shipping_cost) filter (where shipped_at is not null), 0) as shipping_cost
      from items group by product_id
    ),
    visits as (
      select product_id, count(distinct (session_id, landing_page_id)) as visits
      from public.page_events
      where store_id = p_store_id and event_name = 'page_view' and created_at >= p_from and created_at < p_to
      group by product_id
    ),
    spend as (
      select product_id, sum(amount) as ad_spend
      from public.expenses
      where store_id = p_store_id and product_id is not null
        and category in ('meta_ads', 'tiktok_ads', 'google_ads')
        and expense_date between p_from_date and p_to_date
      group by product_id
    )
    select jsonb_agg(jsonb_build_object(
      'product_id', p.id,
      'name', p.name,
      'visits', coalesce(v.visits, 0),
      'orders', coalesce(a.orders, 0),
      'confirmed', coalesce(a.confirmed, 0),
      'shipped', coalesce(a.shipped, 0),
      'delivered', coalesce(a.delivered, 0),
      'orders_value', coalesce(a.orders_value, 0),
      'revenue', coalesce(a.revenue, 0),
      'product_cost', coalesce(a.product_cost, 0),
      'shipping_cost', coalesce(a.shipping_cost, 0),
      'ad_spend', coalesce(s.ad_spend, 0)
    ) order by coalesce(a.revenue, 0) desc, coalesce(a.orders, 0) desc, p.name)
    from public.products p
    left join agg a on a.product_id = p.id
    left join visits v on v.product_id = p.id
    left join spend s on s.product_id = p.id
    where p.store_id = p_store_id
      and (p.status <> 'archived' or a.orders is not null)
  ), '[]'::jsonb);
end;
$$;
grant execute on function public.get_product_stats(uuid, timestamptz, timestamptz, date, date) to authenticated;

-- ---------------------------------------------------------------------
-- Geografía: departamento → provincia → distrito
-- ---------------------------------------------------------------------
create or replace function public.get_geo_stats(
  p_store_id uuid, p_from timestamptz, p_to timestamptz, p_level text, p_parent text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_store_member(p_store_id) then
    raise exception 'Sin acceso' using errcode = '42501';
  end if;
  if p_level not in ('department', 'province', 'district') then
    raise exception 'Nivel inválido' using errcode = 'P0001';
  end if;
  return coalesce((
    with o as (
      select
        case p_level when 'department' then ord.department_code
                     when 'province' then ord.province_code
                     else ord.district_code end as geo_code,
        case p_level when 'department' then ord.department_name
                     when 'province' then ord.province_name
                     else ord.district_name end as geo_name,
        ord.*
      from public.orders ord
      where ord.store_id = p_store_id and ord.created_at >= p_from and ord.created_at < p_to
        and (p_parent is null
          or (p_level = 'province' and ord.department_code = p_parent)
          or (p_level = 'district' and ord.province_code = p_parent))
    )
    select jsonb_agg(row_to_json(g)::jsonb order by g.orders desc, g.name)
    from (
      select
        geo_code as code,
        max(geo_name) as name,
        count(*) as orders,
        count(*) filter (where confirmed_at is not null) as confirmed,
        count(*) filter (where shipped_at is not null) as shipped,
        count(*) filter (where delivered_at is not null and status not in ('failed_delivery', 'returned')) as delivered,
        count(*) filter (where status = 'cancelled') as cancelled,
        count(*) filter (where status in ('failed_delivery', 'returned')) as failed,
        coalesce(sum(total) filter (where delivered_at is not null and status not in ('failed_delivery', 'returned')), 0) as revenue,
        coalesce(sum(product_cost_total) filter (where delivered_at is not null and status not in ('failed_delivery', 'returned')), 0) as product_cost,
        coalesce(sum(shipping_cost) filter (where shipped_at is not null), 0) as shipping_cost
      from o
      group by geo_code
    ) g
  ), '[]'::jsonb);
end;
$$;
grant execute on function public.get_geo_stats(uuid, timestamptz, timestamptz, text, text) to authenticated;

-- >>> supabase/migrations/20261008001100_admin.sql
-- =====================================================================
-- Vendia — Panel de administración de la plataforma
-- Todas las funciones verifican is_platform_admin(); un vendedor normal recibe error.
-- Para nombrar un admin: npx tsx scripts/make-admin.ts tu@correo.com
-- =====================================================================

create or replace function public.admin_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Solo administradores' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'users', (select count(*) from auth.users),
    'stores', (select count(*) from public.stores),
    'stores_blocked', (select count(*) from public.stores where status = 'blocked'),
    'orders', (select count(*) from public.orders),
    'orders_30d', (select count(*) from public.orders where created_at > now() - interval '30 days'),
    'delivered', (select count(*) from public.orders where delivered_at is not null and status not in ('failed_delivery', 'returned')),
    'revenue', (select coalesce(sum(total), 0) from public.orders where delivered_at is not null and status not in ('failed_delivery', 'returned')),
    'landings_published', (select count(*) from public.landing_pages where status = 'published'),
    'meta_events_failed', (select count(*) from public.marketing_events where status = 'failed'),
    'integration_errors_7d', (select count(*) from public.integration_logs where not success and created_at > now() - interval '7 days')
  );
end;
$$;

create or replace function public.admin_list_stores()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Solo administradores' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', s.id,
      'name', s.name,
      'slug', s.slug,
      'status', s.status,
      'created_at', s.created_at,
      'owner_email', u.email,
      'orders', (select count(*) from public.orders o where o.store_id = s.id),
      'delivered', (select count(*) from public.orders o where o.store_id = s.id and o.delivered_at is not null and o.status not in ('failed_delivery', 'returned')),
      'landings', (select count(*) from public.landing_pages l where l.store_id = s.id and l.status = 'published'),
      'last_order_at', (select max(o.created_at) from public.orders o where o.store_id = s.id)
    ) order by s.created_at desc)
    from public.stores s
    left join auth.users u on u.id = s.owner_id
  ), '[]'::jsonb);
end;
$$;

create or replace function public.admin_list_users()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Solo administradores' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', u.id,
      'email', u.email,
      'created_at', u.created_at,
      'last_sign_in_at', u.last_sign_in_at,
      'store', (select s.name from public.stores s where s.owner_id = u.id limit 1),
      'is_admin', exists (select 1 from public.platform_admins a where a.user_id = u.id)
    ) order by u.created_at desc)
    from auth.users u
  ), '[]'::jsonb);
end;
$$;

create or replace function public.admin_recent_orders(p_limit integer default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Solo administradores' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(row_to_json(r)::jsonb)
    from (
      select o.id, o.order_number, o.created_at, o.status, o.total, o.district_name, s.name as store_name
      from public.orders o join public.stores s on s.id = o.store_id
      order by o.created_at desc
      limit least(greatest(p_limit, 1), 200)
    ) r
  ), '[]'::jsonb);
end;
$$;

create or replace function public.admin_recent_errors()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Solo administradores' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'marketing', coalesce((
      select jsonb_agg(row_to_json(r)::jsonb) from (
        select m.created_at, s.name as store_name, m.event_name, m.event_id, m.attempts, m.last_error
        from public.marketing_events m join public.stores s on s.id = m.store_id
        where m.status = 'failed' order by m.created_at desc limit 50
      ) r), '[]'::jsonb),
    'integrations', coalesce((
      select jsonb_agg(row_to_json(r)::jsonb) from (
        select l.created_at, s.name as store_name, l.provider, l.operation, l.status_code, l.message
        from public.integration_logs l left join public.stores s on s.id = l.store_id
        where not l.success order by l.created_at desc limit 50
      ) r), '[]'::jsonb),
    'webhooks', coalesce((
      select jsonb_agg(row_to_json(r)::jsonb) from (
        select w.created_at, s.name as store_name, w.provider, w.external_event_id, w.signature_valid, w.error
        from public.webhook_events w left join public.stores s on s.id = w.store_id
        where w.error is not null or not w.signature_valid order by w.created_at desc limit 50
      ) r), '[]'::jsonb)
  );
end;
$$;

create or replace function public.admin_set_store_status(p_store_id uuid, p_status public.store_status)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Solo administradores' using errcode = '42501';
  end if;
  update public.stores set status = p_status where id = p_store_id;
end;
$$;

revoke all on function public.admin_overview() from public, anon;
revoke all on function public.admin_list_stores() from public, anon;
revoke all on function public.admin_list_users() from public, anon;
revoke all on function public.admin_recent_orders(integer) from public, anon;
revoke all on function public.admin_recent_errors() from public, anon;
revoke all on function public.admin_set_store_status(uuid, public.store_status) from public, anon;
grant execute on function public.admin_overview() to authenticated;
grant execute on function public.admin_list_stores() to authenticated;
grant execute on function public.admin_list_users() to authenticated;
grant execute on function public.admin_recent_orders(integer) to authenticated;
grant execute on function public.admin_recent_errors() to authenticated;
grant execute on function public.admin_set_store_status(uuid, public.store_status) to authenticated;
