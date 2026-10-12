-- =====================================================================
-- Vendia — Borrar notificaciones y nombres de anuncios desde el link
--  · Cada persona puede borrar sus notificaciones (una o todas). Solo se
--    ocultan para quien las borra: el resto del equipo las sigue viendo.
--  · Rendimiento: si Meta todavía no trae el nombre de la campaña, conjunto
--    o anuncio, se usa el que viene en el link (utm_campaign, utm_term,
--    utm_content) en vez del número.
-- =====================================================================

alter table public.notification_reads add column dismissed_at timestamptz;

-- Las borradas dejan de verse (en la campana, la página y en tiempo real) solo para esa persona
drop policy if exists "notifications: miembros leen" on public.notifications;
create policy "notifications: miembros leen" on public.notifications
  for select to authenticated using (
    public.is_store_member(store_id)
    and not exists (
      select 1 from public.notification_reads r
      where r.notification_id = notifications.id and r.user_id = (select auth.uid()) and r.dismissed_at is not null
    )
  );

create or replace function public.dismiss_notifications(p_store_id uuid, p_ids uuid[] default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if not public.is_store_member(p_store_id) then
    raise exception 'Sin acceso' using errcode = '42501';
  end if;
  if p_ids is not null and cardinality(p_ids) > 500 then
    raise exception 'Demasiadas notificaciones' using errcode = 'P0001';
  end if;
  insert into public.notification_reads (notification_id, user_id, dismissed_at)
  select n.id, (select auth.uid()), now() from public.notifications n
  where n.store_id = p_store_id and (p_ids is null or n.id = any (p_ids))
  on conflict (notification_id, user_id) do update set dismissed_at = excluded.dismissed_at;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.dismiss_notifications(uuid, uuid[]) from public, anon;
grant execute on function public.dismiss_notifications(uuid, uuid[]) to authenticated;

-- Rendimiento con nombres del link cuando Meta no los tiene
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
    -- Nombres que trae el link del anuncio (utm_campaign / utm_term / utm_content) para cuando
    -- Meta todavía no los leyó o la cuenta no está conectada: el más reciente de cada anuncio.
    utm as (
      select x.key,
        (array_agg(x.c order by x.created_at desc) filter (where x.c is not null))[1] as campaign_name,
        (array_agg(x.s order by x.created_at desc) filter (where x.s is not null))[1] as adset_name,
        (array_agg(x.ad order by x.created_at desc) filter (where x.ad is not null))[1] as ad_name
      from (
        select
          case p_level when 'campaign' then a.campaign_id when 'adset' then a.adset_id else a.ad_id end as key,
          -- Vacío o la plantilla sin reemplazar ({{campaign.name}}) no sirve como nombre
          case when trim(a.utm_campaign) <> '' and strpos(a.utm_campaign, '{{') = 0 then left(trim(a.utm_campaign), 200) end as c,
          case when trim(a.utm_term) <> '' and strpos(a.utm_term, '{{') = 0 then left(trim(a.utm_term), 200) end as s,
          case when trim(a.utm_content) <> '' and strpos(a.utm_content, '{{') = 0 then left(trim(a.utm_content), 200) end as ad,
          a.created_at
        from public.order_attribution a
        where p_level in ('campaign', 'adset', 'ad') and a.store_id = p_store_id
          and a.created_at >= p_from - interval '90 days' and a.created_at < p_to
      ) x
      where nullif(x.key, '') is not null
      group by x.key
    ),
    keys as (
      select key from agg union select key from ins where key is not null union select key from visits where key is not null
    )
    select jsonb_agg(jsonb_build_object(
      'key', k.key,
      'name', coalesce(me.name, lp.title,
        case p_level when 'campaign' then utm.campaign_name when 'adset' then utm.adset_name when 'ad' then utm.ad_name end, k.key),
      'name_from_utm', me.name is null and lp.title is null
        and (case p_level when 'campaign' then utm.campaign_name when 'adset' then utm.adset_name when 'ad' then utm.ad_name end) is not null,
      'status', me.status,
      'campaign_name', case when p_level in ('adset', 'ad') then coalesce((select c.name from public.meta_entities c where c.store_id = p_store_id and c.id = me.campaign_id), utm.campaign_name) end,
      'adset_name', case when p_level = 'ad' then coalesce((select s.name from public.meta_entities s where s.store_id = p_store_id and s.id = me.adset_id), utm.adset_name) end,
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
    left join utm on utm.key = k.key
    left join public.meta_entities me on p_level in ('campaign', 'adset', 'ad') and me.store_id = p_store_id and me.id = k.key
    left join public.landing_pages lp on p_level = 'page' and lp.store_id = p_store_id and lp.id::text = k.key
  ), '[]'::jsonb);
end;
$$;
