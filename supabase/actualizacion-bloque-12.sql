-- Vendia — Actualización Bloque 12: varios ángulos en una sola landing (?angulo=)
-- Pegar en Supabase → SQL Editor → New query → Run. Una sola vez.
-- Validado localmente con scripts/validate-sql.ts (PGlite + prueba de humo).

-- =====================================================================
-- Vendia — Varios ángulos en una sola landing
--  · El cliente que llega con ?angulo=acne ve esa versión de la landing.
--  · order_attribution.angle y page_events.angle guardan con qué ángulo llegó
--    cada pedido y cada visita (el nombre del ángulo). Sin ángulo en el link,
--    vale el «Ángulo de esta landing» de siempre.
--  · get_performance (nivel «angle») usa el ángulo de cada pedido y visita;
--    el gasto de cada anuncio va al ángulo de la mayoría de sus pedidos.
-- =====================================================================

alter table public.order_attribution
  add column angle text check (angle is null or char_length(angle) <= 60);
alter table public.page_events
  add column angle text check (angle is null or char_length(angle) <= 60);

-- Registro de visitas con el ángulo (mismo comportamiento que antes si no viene)
drop function if exists public.track_landing_event(uuid, text, text, text, text, text);
create or replace function public.track_landing_event(
  p_landing_id uuid,
  p_event text,
  p_session text,
  p_utm_source text default null,
  p_utm_campaign text default null,
  p_campaign_id text default null,
  p_angle text default null
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
  insert into public.page_events (store_id, landing_page_id, product_id, event_name, session_id, utm_source, utm_campaign, campaign_id, angle)
  values (v_landing.store_id, v_landing.id, v_landing.product_id, p_event, p_session,
          left(p_utm_source, 255), left(p_utm_campaign, 255), left(p_campaign_id, 64), nullif(left(trim(p_angle), 60), ''))
  on conflict do nothing;
end;
$$;
revoke all on function public.track_landing_event(uuid, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.track_landing_event(uuid, text, text, text, text, text, text) to service_role;

-- Rendimiento por ángulo con el ángulo de cada pedido y visita
create or replace function public.get_performance(
  p_store_id uuid, p_from timestamptz, p_to timestamptz, p_from_date date, p_to_date date, p_level text
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
  if p_level not in ('campaign', 'adset', 'ad', 'page', 'angle') then
    raise exception 'Nivel inválido' using errcode = 'P0001';
  end if;

  return coalesce((
    with landing_angle as (
      select lp.id, coalesce(nullif(trim(lp.settings ->> 'angle'), ''), '(sin ángulo)') as angle
      from public.landing_pages lp where lp.store_id = p_store_id
    ),
    o as (
      select
        case p_level
          when 'campaign' then coalesce(nullif(a.campaign_id, ''), '(sin campaña)')
          when 'adset' then coalesce(nullif(a.adset_id, ''), '(sin conjunto)')
          when 'ad' then coalesce(nullif(a.ad_id, ''), '(sin anuncio)')
          when 'angle' then coalesce(nullif(trim(a.angle), ''), la.angle, '(pedido manual)')
          else coalesce(ord.landing_page_id::text, '(manual)')
        end as key,
        public.order_is_sale(ord.status, ord.zone, ord.delivered_at, ord.collected_at, v_mode) as is_sale,
        public.order_logistics_cost(ord.status, ord.shipped_at, ord.shipping_cost, ord.return_shipments, ord.packaging_cost) as logistics_cost,
        ord.*
      from public.orders ord
      left join public.order_attribution a on a.order_id = ord.id
      left join landing_angle la on la.id = ord.landing_page_id
      where ord.store_id = p_store_id and ord.created_at >= p_from and ord.created_at < p_to
    ),
    agg as (
      select key,
        count(*) as orders,
        count(*) filter (where confirmed_at is not null) as confirmed,
        count(*) filter (where shipped_at is not null) as shipped,
        count(*) filter (where is_sale) as delivered,
        count(*) filter (where status = 'cancelled') as cancelled,
        count(*) filter (where status in ('failed_delivery', 'returned')) as failed,
        coalesce(sum(total), 0) as orders_value,
        coalesce(sum(total) filter (where is_sale), 0) as revenue,
        coalesce(sum(product_cost_total) filter (where is_sale), 0) as product_cost,
        coalesce(sum(logistics_cost), 0) as shipping_cost
      from o group by key
    ),
    -- El ángulo de cada anuncio: el de la mayoría de sus pedidos (link ?angulo= o el de la landing)
    ad_angle as (
      select distinct on (x.ad_id) x.ad_id, x.angle
      from (
        select a.ad_id, coalesce(nullif(trim(a.angle), ''), la.angle) as angle, count(*) as n
        from public.orders ord
        join public.order_attribution a on a.order_id = ord.id
        left join landing_angle la on la.id = ord.landing_page_id
        where p_level = 'angle' and ord.store_id = p_store_id and ord.created_at >= p_from and ord.created_at < p_to
          and nullif(a.ad_id, '') is not null and ord.landing_page_id is not null
        group by 1, 2
      ) x
      order by x.ad_id, x.n desc
    ),
    ins as (
      select
        case p_level
          when 'campaign' then i.campaign_id
          when 'adset' then i.adset_id
          when 'ad' then i.ad_id
          else coalesce(aa.angle, '(anuncios sin pedidos)')
        end as key,
        sum(i.spend_pen) as ad_spend,
        sum(i.impressions) as impressions,
        sum(i.reach) as reach,
        sum(i.clicks) as clicks,
        sum(i.results) as results
      from public.meta_insights_daily i
      left join ad_angle aa on p_level = 'angle' and aa.ad_id = i.ad_id
      where p_level in ('campaign', 'adset', 'ad', 'angle')
        and i.store_id = p_store_id and i.date between p_from_date and p_to_date
      group by 1
    ),
    visits as (
      select case when p_level = 'angle' then coalesce(nullif(trim(e.angle), ''), la.angle) else e.landing_page_id::text end as key,
        count(distinct (e.session_id, e.landing_page_id)) as visits
      from public.page_events e
      left join landing_angle la on la.id = e.landing_page_id
      where p_level in ('page', 'angle') and e.store_id = p_store_id and e.event_name = 'page_view'
        and e.created_at >= p_from and e.created_at < p_to
      group by 1
    ),
    keys as (
      select key from agg union select key from ins where key is not null union select key from visits where key is not null
    )
    select jsonb_agg(jsonb_build_object(
      'key', k.key,
      'name', coalesce(me.name, lp.title, k.key),
      'status', me.status,
      'campaign_name', case when p_level in ('adset', 'ad') then (select c.name from public.meta_entities c where c.store_id = p_store_id and c.id = me.campaign_id) end,
      'adset_name', case when p_level = 'ad' then (select s.name from public.meta_entities s where s.store_id = p_store_id and s.id = me.adset_id) end,
      'thumbnail_url', me.thumbnail_url,
      'ad_spend', coalesce(ins.ad_spend, 0),
      'impressions', coalesce(ins.impressions, 0),
      'reach', coalesce(ins.reach, 0),
      'clicks', coalesce(ins.clicks, 0),
      'results', coalesce(ins.results, 0),
      'visits', coalesce(v.visits, 0),
      'orders', coalesce(agg.orders, 0),
      'confirmed', coalesce(agg.confirmed, 0),
      'shipped', coalesce(agg.shipped, 0),
      'delivered', coalesce(agg.delivered, 0),
      'cancelled', coalesce(agg.cancelled, 0),
      'failed', coalesce(agg.failed, 0),
      'orders_value', coalesce(agg.orders_value, 0),
      'revenue', coalesce(agg.revenue, 0),
      'product_cost', coalesce(agg.product_cost, 0),
      'shipping_cost', coalesce(agg.shipping_cost, 0)
    ) order by coalesce(ins.ad_spend, 0) desc, coalesce(agg.orders, 0) desc)
    from keys k
    left join agg on agg.key = k.key
    left join ins on ins.key = k.key
    left join visits v on v.key = k.key
    left join public.meta_entities me on p_level in ('campaign', 'adset', 'ad') and me.store_id = p_store_id and me.id = k.key
    left join public.landing_pages lp on p_level = 'page' and lp.store_id = p_store_id and lp.id::text = k.key
  ), '[]'::jsonb);
end;
$$;
