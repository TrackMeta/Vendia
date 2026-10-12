-- Vendia — Actualización Bloque 14: filtro por campaña, conjunto, anuncio, ángulo, producto o página en el Embudo y en Zonas
-- Pegar en Supabase → SQL Editor → New query → Run. Una sola vez.
-- Validado localmente con scripts/validate-sql.ts (PGlite + prueba de humo).

-- =====================================================================
-- Vendia — Filtro en el Embudo y en Zonas (igual que en Anuncios)
--  · Embudo, embudo del formulario y Zonas se pueden ver solo para una
--    campaña, conjunto, anuncio, ángulo, producto o página.
--  · Las visitas guardan también el conjunto y el anuncio del link (antes
--    solo la campaña), para el embudo por conjunto o anuncio.
-- =====================================================================

alter table public.page_events add column adset_id text check (adset_id is null or char_length(adset_id) <= 64);
alter table public.page_events add column ad_id text check (ad_id is null or char_length(ad_id) <= 64);

-- Registro de visitas con conjunto y anuncio
drop function if exists public.track_landing_event(uuid, text, text, text, text, text, text, text);
create or replace function public.track_landing_event(
  p_landing_id uuid,
  p_event text,
  p_session text,
  p_utm_source text default null,
  p_utm_campaign text default null,
  p_campaign_id text default null,
  p_angle text default null,
  p_price_variant text default null,
  p_adset_id text default null,
  p_ad_id text default null
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
  insert into public.page_events (store_id, landing_page_id, product_id, event_name, session_id, utm_source, utm_campaign, campaign_id, angle, price_variant, adset_id, ad_id)
  values (v_landing.store_id, v_landing.id, v_landing.product_id, p_event, p_session,
          left(p_utm_source, 255), left(p_utm_campaign, 255), left(p_campaign_id, 64), nullif(left(trim(p_angle), 60), ''),
          case when p_price_variant in ('A', 'B') then p_price_variant end,
          nullif(left(trim(p_adset_id), 64), ''), nullif(left(trim(p_ad_id), 64), ''))
  on conflict do nothing;
end;
$$;
revoke all on function public.track_landing_event(uuid, text, text, text, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.track_landing_event(uuid, text, text, text, text, text, text, text, text, text) to service_role;

-- ¿El pedido entra en el filtro? Mismas claves que Rendimiento → Anuncios (get_performance)
create or replace function public.order_in_filter(p_order_id uuid, p_landing_id uuid, p_level text, p_key text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select case
    when p_level is null or p_key is null then true
    when p_level = 'page' then coalesce(p_landing_id::text, '(manual)') = p_key
    when p_level = 'product' then exists (
      select 1 from public.order_items i where i.order_id = p_order_id and i.product_id::text = p_key)
    else coalesce((
      select case p_level
        when 'campaign' then coalesce(nullif(a.campaign_id, ''), '(sin campaña)')
        when 'adset' then coalesce(nullif(a.adset_id, ''), '(sin conjunto)')
        when 'ad' then coalesce(nullif(a.ad_id, ''), '(sin anuncio)')
        when 'angle' then coalesce(
          nullif(trim(a.angle), ''),
          case when p_landing_id is not null then coalesce(nullif(trim(lp.settings ->> 'angle'), ''), '(sin ángulo)') end,
          '(pedido manual)')
      end = p_key
      from (select 1) as one
      left join public.order_attribution a on a.order_id = p_order_id
      left join public.landing_pages lp on lp.id = p_landing_id
    ), false)
  end;
$$;

-- ¿La visita entra en el filtro?
create or replace function public.event_in_filter(
  p_campaign_id text, p_adset_id text, p_ad_id text, p_angle text, p_landing_id uuid, p_product_id uuid, p_level text, p_key text
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select case
    when p_level is null or p_key is null then true
    when p_level = 'campaign' then coalesce(nullif(p_campaign_id, ''), '(sin campaña)') = p_key
    when p_level = 'adset' then coalesce(nullif(p_adset_id, ''), '(sin conjunto)') = p_key
    when p_level = 'ad' then coalesce(nullif(p_ad_id, ''), '(sin anuncio)') = p_key
    when p_level = 'angle' then coalesce(
      nullif(trim(p_angle), ''),
      (select coalesce(nullif(trim(lp.settings ->> 'angle'), ''), '(sin ángulo)') from public.landing_pages lp where lp.id = p_landing_id)) = p_key
    when p_level = 'product' then p_product_id::text = p_key
    when p_level = 'page' then p_landing_id::text = p_key
    else false
  end;
$$;

create or replace function public.check_perf_filter(p_level text)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_level is not null and p_level not in ('campaign', 'adset', 'ad', 'angle', 'product', 'page') then
    raise exception 'Filtro inválido' using errcode = 'P0001';
  end if;
end;
$$;

-- Embudo con filtro
drop function if exists public.get_funnel(uuid, timestamptz, timestamptz, uuid);
create or replace function public.get_funnel(
  p_store_id uuid, p_from timestamptz, p_to timestamptz, p_landing_id uuid default null,
  p_filter_level text default null, p_filter_key text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_mode text := public.store_sale_mode(p_store_id);
begin
  if not public.is_store_member(p_store_id) then
    raise exception 'Sin acceso' using errcode = '42501';
  end if;
  perform public.check_perf_filter(p_filter_level);
  return (
    with ev as (
      select e.event_name, count(distinct (e.session_id, e.landing_page_id)) as n
      from public.page_events e
      where e.store_id = p_store_id and e.created_at >= p_from and e.created_at < p_to
        and (p_landing_id is null or e.landing_page_id = p_landing_id)
        and public.event_in_filter(e.campaign_id, e.adset_id, e.ad_id, e.angle, e.landing_page_id, e.product_id, p_filter_level, p_filter_key)
      group by e.event_name
    ),
    o as (
      select ord.*, public.order_is_sale(ord.status, ord.zone, ord.delivered_at, ord.collected_at, v_mode) as is_sale
      from public.orders ord
      where ord.store_id = p_store_id and ord.created_at >= p_from and ord.created_at < p_to
        and (p_landing_id is null or ord.landing_page_id = p_landing_id)
        and public.order_in_filter(ord.id, ord.landing_page_id, p_filter_level, p_filter_key)
    )
    select jsonb_build_object(
      'visits', coalesce((select n from ev where event_name = 'page_view'), 0),
      'view_content', coalesce((select n from ev where event_name = 'view_content'), 0),
      'initiate_checkout', coalesce((select n from ev where event_name = 'initiate_checkout'), 0),
      'orders', (select count(*) from o),
      'confirmed', (select count(*) from o where confirmed_at is not null),
      'shipped', (select count(*) from o where shipped_at is not null),
      'delivered', (select count(*) from o where is_sale),
      'collected', (select count(*) from o where collected_at is not null)
    )
  );
end;
$$;
grant execute on function public.get_funnel(uuid, timestamptz, timestamptz, uuid, text, text) to authenticated;

-- Embudo del formulario con filtro
drop function if exists public.get_form_funnel(uuid, timestamptz, timestamptz);
create or replace function public.get_form_funnel(
  p_store_id uuid, p_from timestamptz, p_to timestamptz, p_filter_level text default null, p_filter_key text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_store_owner(p_store_id) then
    raise exception 'Sin acceso' using errcode = '42501';
  end if;
  perform public.check_perf_filter(p_filter_level);
  return (
    select jsonb_build_object(
      'initiate_checkout', count(distinct (e.session_id, e.landing_page_id)) filter (where e.event_name = 'initiate_checkout'),
      'form_name', count(distinct (e.session_id, e.landing_page_id)) filter (where e.event_name = 'form_name'),
      'form_phone', count(distinct (e.session_id, e.landing_page_id)) filter (where e.event_name = 'form_phone'),
      'form_location', count(distinct (e.session_id, e.landing_page_id)) filter (where e.event_name = 'form_location'),
      'form_address', count(distinct (e.session_id, e.landing_page_id)) filter (where e.event_name = 'form_address'),
      'form_submit', count(distinct (e.session_id, e.landing_page_id)) filter (where e.event_name = 'form_submit'),
      'orders', (select count(*) from public.orders o where o.store_id = p_store_id and o.landing_page_id is not null
                 and o.created_at >= p_from and o.created_at < p_to
                 and public.order_in_filter(o.id, o.landing_page_id, p_filter_level, p_filter_key))
    )
    from public.page_events e
    where e.store_id = p_store_id and e.created_at >= p_from and e.created_at < p_to
      and public.event_in_filter(e.campaign_id, e.adset_id, e.ad_id, e.angle, e.landing_page_id, e.product_id, p_filter_level, p_filter_key)
  );
end;
$$;
grant execute on function public.get_form_funnel(uuid, timestamptz, timestamptz, text, text) to authenticated;

-- Zonas con filtro
drop function if exists public.get_geo_stats(uuid, timestamptz, timestamptz, text, text);
create or replace function public.get_geo_stats(
  p_store_id uuid, p_from timestamptz, p_to timestamptz, p_level text, p_parent text default null,
  p_filter_level text default null, p_filter_key text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_mode text := public.store_sale_mode(p_store_id);
begin
  if not public.is_store_owner(p_store_id) then
    raise exception 'Sin acceso' using errcode = '42501';
  end if;
  if p_level not in ('department', 'province', 'district') then
    raise exception 'Nivel inválido' using errcode = 'P0001';
  end if;
  perform public.check_perf_filter(p_filter_level);
  return coalesce((
    with o as (
      select
        case p_level when 'department' then ord.department_code
                     when 'province' then ord.province_code
                     else ord.district_code end as geo_code,
        case p_level when 'department' then ord.department_name
                     when 'province' then ord.province_name
                     else ord.district_name end as geo_name,
        public.order_is_sale(ord.status, ord.zone, ord.delivered_at, ord.collected_at, v_mode) as is_sale,
        public.order_logistics_cost(ord.status, ord.shipped_at, ord.shipping_cost, ord.return_shipments, ord.packaging_cost) as logistics_cost,
        ord.*
      from public.orders ord
      where ord.store_id = p_store_id and ord.created_at >= p_from and ord.created_at < p_to
        and (p_parent is null
          or (p_level = 'province' and ord.department_code = p_parent)
          or (p_level = 'district' and ord.province_code = p_parent))
        and public.order_in_filter(ord.id, ord.landing_page_id, p_filter_level, p_filter_key)
    )
    select jsonb_agg(row_to_json(g)::jsonb order by g.orders desc, g.name)
    from (
      select
        geo_code as code,
        max(geo_name) as name,
        count(*) as orders,
        count(*) filter (where confirmed_at is not null) as confirmed,
        count(*) filter (where shipped_at is not null) as shipped,
        count(*) filter (where is_sale) as delivered,
        count(*) filter (where status = 'cancelled') as cancelled,
        count(*) filter (where status in ('failed_delivery', 'returned')) as failed,
        coalesce(sum(total) filter (where is_sale), 0) as revenue,
        coalesce(sum(product_cost_total) filter (where is_sale), 0) as product_cost,
        coalesce(sum(logistics_cost), 0) as shipping_cost
      from o
      group by geo_code
    ) g
  ), '[]'::jsonb);
end;
$$;
grant execute on function public.get_geo_stats(uuid, timestamptz, timestamptz, text, text, text, text) to authenticated;
