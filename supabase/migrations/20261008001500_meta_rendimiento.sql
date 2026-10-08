-- =====================================================================
-- Vendia — Bloque 4: Meta total y Rendimiento
--  · «Conectar Meta» con un token de usuario del sistema: cuenta publicitaria,
--    moneda y Pixel (el mismo token se usa para Conversions API).
--  · Sincronización diaria: campañas, conjuntos y anuncios con sus métricas por día.
--    El gasto se guarda también como gasto (por campaña y día) para el CPA real.
--  · Rendimiento: métricas de Meta junto a las de Vendia (CPA real, utilidad).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Conexión (el token sigue cifrado en capi_token_encrypted y nunca es legible)
-- ---------------------------------------------------------------------
alter table public.store_meta_settings
  add column ad_account_id text check (ad_account_id is null or ad_account_id ~ '^act_[0-9]{5,25}$'),
  add column ad_account_name text check (ad_account_name is null or char_length(ad_account_name) <= 200),
  add column ad_account_currency char(3),
  add column meta_user_name text check (meta_user_name is null or char_length(meta_user_name) <= 200),
  add column connected_at timestamptz,
  add column sync_enabled boolean not null default true,
  add column last_sync_at timestamptz,
  add column last_sync_error text check (last_sync_error is null or char_length(last_sync_error) <= 1000);
grant select (ad_account_id, ad_account_name, ad_account_currency, meta_user_name, connected_at, sync_enabled, last_sync_at, last_sync_error)
  on public.store_meta_settings to authenticated;
-- La conexión la escribe el servidor (service role) tras validar al dueño.

-- El gasto sincronizado se distingue del importado por CSV
alter table public.expenses drop constraint expenses_source_check;
alter table public.expenses add constraint expenses_source_check check (source in ('manual', 'import', 'meta_sync'));

-- ---------------------------------------------------------------------
-- 2. Campañas, conjuntos y anuncios (nombres, estado y creatividad del anuncio)
-- ---------------------------------------------------------------------
create table public.meta_entities (
  store_id uuid not null references public.stores (id) on delete cascade,
  id text not null check (id ~ '^[0-9]{5,30}$'),
  level text not null check (level in ('campaign', 'adset', 'ad')),
  name text check (name is null or char_length(name) <= 400),
  campaign_id text,
  adset_id text,
  status text check (status is null or char_length(status) <= 40),
  thumbnail_url text check (thumbnail_url is null or char_length(thumbnail_url) <= 2000),
  body text check (body is null or char_length(body) <= 3000),
  title text check (title is null or char_length(title) <= 400),
  preview_url text check (preview_url is null or char_length(preview_url) <= 2000),
  updated_at timestamptz not null default now(),
  primary key (store_id, id)
);
create index meta_entities_level_idx on public.meta_entities (store_id, level);

alter table public.meta_entities enable row level security;
revoke all on public.meta_entities from anon, authenticated;
grant select on public.meta_entities to authenticated;
-- Todo el equipo ve la tarjeta del anuncio en el pedido
create policy "meta_entities: miembros leen" on public.meta_entities
  for select to authenticated using (public.is_store_member(store_id));

-- ---------------------------------------------------------------------
-- 3. Métricas diarias por anuncio (gasto ya convertido a soles con el TC e IGV del día)
-- ---------------------------------------------------------------------
create table public.meta_insights_daily (
  store_id uuid not null references public.stores (id) on delete cascade,
  date date not null,
  ad_id text not null,
  adset_id text,
  campaign_id text,
  spend numeric(14, 2) not null default 0 check (spend >= 0),
  spend_pen numeric(14, 2) not null default 0 check (spend_pen >= 0),
  impressions bigint not null default 0,
  reach bigint not null default 0,
  clicks bigint not null default 0,
  results integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (store_id, date, ad_id)
);
create index meta_insights_campaign_idx on public.meta_insights_daily (store_id, campaign_id, date);

alter table public.meta_insights_daily enable row level security;
revoke all on public.meta_insights_daily from anon, authenticated;
grant select on public.meta_insights_daily to authenticated;
-- Gasto = finanzas: solo el dueño
create policy "meta_insights: dueño lee" on public.meta_insights_daily
  for select to authenticated using (public.is_store_owner(store_id));

-- ---------------------------------------------------------------------
-- 4. Rendimiento: Meta + Vendia por campaña, conjunto, anuncio o página
-- ---------------------------------------------------------------------
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
  if p_level not in ('campaign', 'adset', 'ad', 'page') then
    raise exception 'Nivel inválido' using errcode = 'P0001';
  end if;

  return coalesce((
    with o as (
      select
        case p_level
          when 'campaign' then coalesce(nullif(a.campaign_id, ''), '(sin campaña)')
          when 'adset' then coalesce(nullif(a.adset_id, ''), '(sin conjunto)')
          when 'ad' then coalesce(nullif(a.ad_id, ''), '(sin anuncio)')
          else coalesce(ord.landing_page_id::text, '(manual)')
        end as key,
        public.order_is_sale(ord.status, ord.zone, ord.delivered_at, ord.collected_at, v_mode) as is_sale,
        public.order_logistics_cost(ord.status, ord.shipped_at, ord.shipping_cost, ord.return_shipments) as logistics_cost,
        ord.*
      from public.orders ord
      left join public.order_attribution a on a.order_id = ord.id
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
    ins as (
      select
        case p_level when 'campaign' then i.campaign_id when 'adset' then i.adset_id else i.ad_id end as key,
        sum(i.spend_pen) as ad_spend,
        sum(i.impressions) as impressions,
        sum(i.reach) as reach,
        sum(i.clicks) as clicks,
        sum(i.results) as results
      from public.meta_insights_daily i
      where p_level in ('campaign', 'adset', 'ad')
        and i.store_id = p_store_id and i.date between p_from_date and p_to_date
      group by 1
    ),
    visits as (
      select e.landing_page_id::text as key, count(distinct (e.session_id, e.landing_page_id)) as visits
      from public.page_events e
      where p_level = 'page' and e.store_id = p_store_id and e.event_name = 'page_view'
        and e.created_at >= p_from and e.created_at < p_to
      group by 1
    ),
    keys as (
      select key from agg union select key from ins where key is not null union select key from visits where key is not null
    )
    select jsonb_agg(jsonb_build_object(
      'key', k.key,
      'name', coalesce(me.name, lp.title, case when k.key like '(%' then k.key end, k.key),
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
    left join public.meta_entities me on p_level <> 'page' and me.store_id = p_store_id and me.id = k.key
    left join public.landing_pages lp on p_level = 'page' and lp.store_id = p_store_id and lp.id::text = k.key
  ), '[]'::jsonb);
end;
$$;
grant execute on function public.get_performance(uuid, timestamptz, timestamptz, date, date, text) to authenticated;
