-- Vendia — Actualización Bloque 3: Números correctos
-- Pegar en Supabase → SQL Editor → New query → Run. Una sola vez.
-- Validado localmente con scripts/validate-sql.ts (PGlite + prueba de humo).

-- =====================================================================
-- Vendia — Bloque 3: Números correctos
--  · Venta real configurable: por zona (Lima = Entregado, Provincia = Cobrado)
--    o «Entregado» en ambas. Se aplica en TODAS las métricas y en el Purchase de Meta.
--  · Moneda de la cuenta publicitaria (PEN/USD) con tipo de cambio guardado
--    por gasto e IGV 18 % opcional → cada gasto tiene su monto en soles.
--  · Costo logístico real: envío, o 0/1/2 envíos si no se entregó.
--  · % de pedidos atribuidos a una campaña.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Configuración
-- ---------------------------------------------------------------------
alter table public.store_settings
  add column real_sale_mode text not null default 'zone' check (real_sale_mode in ('zone', 'delivered')),
  add column ad_currency char(3) not null default 'PEN' check (ad_currency in ('PEN', 'USD')),
  add column usd_rate numeric(8, 4) not null default 3.75 check (usd_rate > 0 and usd_rate < 100),
  add column apply_igv boolean not null default false;
grant update (real_sale_mode, ad_currency, usd_rate, apply_igv) on public.store_settings to authenticated;

-- ---------------------------------------------------------------------
-- 2. Gastos en soles: monto original × tipo de cambio × (1 + IGV)
-- ---------------------------------------------------------------------
alter table public.expenses drop constraint expenses_currency_check;
alter table public.expenses
  add constraint expenses_currency_check check (currency in ('PEN', 'USD')),
  add column exchange_rate numeric(10, 4) not null default 1 check (exchange_rate > 0 and exchange_rate < 100),
  add column igv_rate numeric(5, 4) not null default 0 check (igv_rate between 0 and 0.5),
  add column amount_pen numeric(14, 2) generated always as (round(amount * exchange_rate * (1 + igv_rate), 2)) stored;

-- ---------------------------------------------------------------------
-- 3. Reglas centrales (una sola definición para todas las métricas)
-- ---------------------------------------------------------------------
-- ¿El pedido cuenta como venta real?
create or replace function public.order_is_sale(
  p_status public.order_status, p_zone text, p_delivered_at timestamptz, p_collected_at timestamptz, p_mode text
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_status not in ('cancelled', 'failed_delivery', 'returned')
    and case
      when p_mode = 'delivered' or p_zone = 'lima' then p_delivered_at is not null
      else p_collected_at is not null
    end;
$$;

-- Costo logístico: lo que se pagó al courier (si no se entregó: 0, 1 o 2 envíos)
create or replace function public.order_logistics_cost(
  p_status public.order_status, p_shipped_at timestamptz, p_shipping_cost numeric, p_return_shipments smallint
)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case
    when p_shipped_at is null then 0
    when p_status in ('failed_delivery', 'returned') then p_shipping_cost * coalesce(p_return_shipments, 1)
    else p_shipping_cost
  end;
$$;

create or replace function public.store_sale_mode(p_store_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select s.real_sale_mode from public.store_settings s where s.store_id = p_store_id), 'zone');
$$;
revoke all on function public.store_sale_mode(uuid) from public, anon;
grant execute on function public.store_sale_mode(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 4. Estadísticas (claves iguales que antes: «delivered» y «revenue» = venta real)
-- ---------------------------------------------------------------------
create or replace function public.get_order_stats(p_store_id uuid, p_from timestamptz, p_to timestamptz)
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

  return (
    with o as (
      select ord.*,
        public.order_is_sale(ord.status, ord.zone, ord.delivered_at, ord.collected_at, v_mode) as is_sale,
        exists (
          select 1 from public.order_attribution a
          where a.order_id = ord.id and (nullif(a.campaign_id, '') is not null or nullif(a.utm_campaign, '') is not null)
        ) as is_attributed
      from public.orders ord
      where ord.store_id = p_store_id and ord.created_at >= p_from and ord.created_at < p_to
    )
    select jsonb_build_object(
      'sale_mode', v_mode,
      'orders', count(*),
      'orders_value', coalesce(sum(total), 0),
      'confirmed', count(*) filter (where confirmed_at is not null),
      'shipped', count(*) filter (where shipped_at is not null),
      'delivered', count(*) filter (where is_sale),
      'collected', count(*) filter (where collected_at is not null),
      'cancelled', count(*) filter (where status = 'cancelled'),
      'failed', count(*) filter (where status in ('failed_delivery', 'returned')),
      'in_progress', count(*) filter (where not is_sale and status not in ('cancelled', 'failed_delivery', 'returned')),
      'attributed', count(*) filter (where is_attributed),
      'revenue', coalesce(sum(total) filter (where is_sale), 0),
      'product_cost', coalesce(sum(product_cost_total) filter (where is_sale), 0),
      'shipping_cost', coalesce(sum(public.order_logistics_cost(status, shipped_at, shipping_cost, return_shipments)), 0)
    )
    from o
  );
end;
$$;

create or replace function public.get_expense_totals(p_store_id uuid, p_from date, p_to date)
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
  return (
    select jsonb_build_object(
      'ad_spend', coalesce(sum(e.amount_pen) filter (where e.category in ('meta_ads', 'tiktok_ads', 'google_ads')), 0),
      'meta_spend', coalesce(sum(e.amount_pen) filter (where e.category = 'meta_ads'), 0),
      'igv', coalesce(sum(e.amount_pen - round(e.amount * e.exchange_rate, 2)), 0),
      'other_expenses', coalesce(sum(e.amount_pen) filter (where e.category not in ('meta_ads', 'tiktok_ads', 'google_ads', 'product', 'courier', 'shipping')), 0),
      'reference_only', coalesce(sum(e.amount_pen) filter (where e.category in ('product', 'courier', 'shipping')), 0),
      'by_category', coalesce((
        select jsonb_object_agg(c.category, c.total)
        from (
          select x.category, sum(x.amount_pen) as total
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

create or replace function public.get_campaign_stats(
  p_store_id uuid, p_from timestamptz, p_to timestamptz, p_from_date date, p_to_date date
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
  return coalesce((
    with o as (
      select
        coalesce(nullif(a.campaign_id, ''), nullif(a.utm_campaign, ''), '(directo)') as campaign_key,
        nullif(a.campaign_id, '') as campaign_id,
        a.utm_campaign,
        a.utm_source,
        public.order_is_sale(ord.status, ord.zone, ord.delivered_at, ord.collected_at, v_mode) as is_sale,
        public.order_logistics_cost(ord.status, ord.shipped_at, ord.shipping_cost, ord.return_shipments) as logistics_cost,
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
        count(*) filter (where is_sale) as delivered,
        count(*) filter (where status = 'cancelled') as cancelled,
        coalesce(sum(total), 0) as orders_value,
        coalesce(sum(total) filter (where is_sale), 0) as revenue,
        coalesce(sum(product_cost_total) filter (where is_sale), 0) as product_cost,
        coalesce(sum(logistics_cost), 0) as shipping_cost
      from o
      group by campaign_key
    ),
    spend as (
      select e.campaign_id as campaign_key, sum(e.amount_pen) as ad_spend, max(e.campaign_name) as campaign_name
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

create or replace function public.get_product_stats(
  p_store_id uuid, p_from timestamptz, p_to timestamptz, p_from_date date, p_to_date date
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
  return coalesce((
    with items as (
      select distinct on (ord.id) ord.*, oi.product_id,
        public.order_is_sale(ord.status, ord.zone, ord.delivered_at, ord.collected_at, v_mode) as is_sale,
        public.order_logistics_cost(ord.status, ord.shipped_at, ord.shipping_cost, ord.return_shipments) as logistics_cost
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
        count(*) filter (where is_sale) as delivered,
        coalesce(sum(total), 0) as orders_value,
        coalesce(sum(total) filter (where is_sale), 0) as revenue,
        coalesce(sum(product_cost_total) filter (where is_sale), 0) as product_cost,
        coalesce(sum(logistics_cost), 0) as shipping_cost
      from items group by product_id
    ),
    visits as (
      select product_id, count(distinct (session_id, landing_page_id)) as visits
      from public.page_events
      where store_id = p_store_id and event_name = 'page_view' and created_at >= p_from and created_at < p_to
      group by product_id
    ),
    spend as (
      select product_id, sum(amount_pen) as ad_spend
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

create or replace function public.get_geo_stats(
  p_store_id uuid, p_from timestamptz, p_to timestamptz, p_level text, p_parent text default null
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
        public.order_logistics_cost(ord.status, ord.shipped_at, ord.shipping_cost, ord.return_shipments) as logistics_cost,
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

create or replace function public.get_funnel(p_store_id uuid, p_from timestamptz, p_to timestamptz, p_landing_id uuid default null)
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
  return (
    with ev as (
      select e.event_name, count(distinct (e.session_id, e.landing_page_id)) as n
      from public.page_events e
      where e.store_id = p_store_id and e.created_at >= p_from and e.created_at < p_to
        and (p_landing_id is null or e.landing_page_id = p_landing_id)
      group by e.event_name
    ),
    o as (
      select ord.*, public.order_is_sale(ord.status, ord.zone, ord.delivered_at, ord.collected_at, v_mode) as is_sale
      from public.orders ord
      where ord.store_id = p_store_id and ord.created_at >= p_from and ord.created_at < p_to
        and (p_landing_id is null or ord.landing_page_id = p_landing_id)
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
