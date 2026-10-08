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
