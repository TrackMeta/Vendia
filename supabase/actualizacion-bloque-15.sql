-- Vendia — Actualización Bloque 15: correcciones de la auditoría (pagos, Liquidación, números y seguridad)
-- Pegar en Supabase → SQL Editor → New query → Run. Una sola vez.
-- Validado localmente con scripts/validate-sql.ts (PGlite + prueba de humo).

-- =====================================================================
-- Vendia — Correcciones de la auditoría (Bloque 15)
--  · Pagos: el pago del saldo baja el saldo a cobrar (antes solo el adelanto) y
--    registrar un pago ya no reinicia el adelanto escrito a mano.
--  · Lima: «Cobrado» solo al liquidar con el courier (Liquidación).
--  · Liquidación: descuenta también lo que cobra el courier por envíos fallidos.
--  · Un costo de envío puesto en 0 a mano ya no se reemplaza por el del courier.
--  · Un pedido cancelado vuelve a poder exportarse.
--  · Números: el gasto de Gastos entra en Rendimiento cuando Meta no lo trae, el gasto
--    escrito a mano no se suma dos veces con el de Meta, cada pedido cuenta para su
--    producto principal (no el adicional), la prueba de precio guarda la versión que
--    vio el cliente y el embudo solo cuenta pedidos que vinieron de una landing.
--  · Seguridad: la landing pública ya no expone costos, un pedido público no
--    sobrescribe los datos de un cliente existente, el personal no puede borrar ni
--    cambiar imágenes de la tienda ni comprobantes verificados, y la asignación de
--    pedidos solo se hace con la función que valida al equipo.
-- =====================================================================

-- Saldo a cobrar = total − adelanto − pagos del saldo (antes la regla obligaba total − adelanto)
do $$
declare
  c text;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.orders'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%balance_due = (total - advance_amount)%'
  loop
    execute format('alter table public.orders drop constraint %I', c);
  end loop;
end;
$$;
alter table public.orders add constraint orders_balance_due_range check (balance_due >= 0 and balance_due <= total - advance_amount);

create or replace function public.sync_order_advance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_id uuid := coalesce(new.order_id, old.order_id);
  v_advance numeric(12, 2);
  v_advance_rows integer;
  v_balance numeric(12, 2);
  v_default numeric(12, 2);
begin
  select coalesce(sum(amount) filter (where kind = 'advance'), 0), count(*) filter (where kind = 'advance'),
         coalesce(sum(amount) filter (where kind = 'balance'), 0)
  into v_advance, v_advance_rows, v_balance
  from public.order_payments where order_id = v_order_id;

  if v_advance_rows = 0 then
    if (tg_op in ('DELETE', 'UPDATE') and old.kind = 'advance') then
      -- Se quitó el último adelanto pagado: vuelve al adelanto configurado (solo provincia)
      select case when o.zone = 'provincia' then coalesce(s.advance_amount, 0) else 0 end into v_default
      from public.orders o left join public.store_settings s on s.store_id = o.store_id
      where o.id = v_order_id;
      v_advance := coalesce(v_default, 0);
    else
      -- Sin adelantos pagados: se respeta el adelanto que ya tiene el pedido (configurado o escrito a mano)
      select o.advance_amount into v_advance from public.orders o where o.id = v_order_id;
    end if;
  end if;

  update public.orders o set
    advance_amount = least(coalesce(v_advance, 0), o.total),
    balance_due = greatest(o.total - least(coalesce(v_advance, 0), o.total) - v_balance, 0)
  where o.id = v_order_id;
  return null;
end;
$$;

-- Recalcula los pedidos que ya tienen pagos del saldo registrados
update public.orders o set balance_due = greatest(o.total - o.advance_amount - p.paid, 0)
from (select order_id, sum(amount) as paid from public.order_payments where kind = 'balance' group by order_id) p
where p.order_id = o.id;

-- En Lima «Cobrado» = el courier ya te depositó: se marca desde Liquidación
create or replace function public.change_order_status(
  p_order_id uuid,
  p_to public.order_status,
  p_note text default null,
  p_reason text default null
)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_store_id uuid;
  v_order public.orders;
begin
  select store_id into v_store_id from public.orders where id = p_order_id;
  if v_store_id is null or not public.is_store_member(v_store_id) then
    raise exception 'Pedido no encontrado' using errcode = 'P0002';
  end if;
  if p_to = 'collected' and exists (select 1 from public.orders where id = p_order_id and zone = 'lima') then
    raise exception 'En Lima un pedido pasa a «Cobrado» al liquidarlo en Liquidación (cuando el courier te deposita)' using errcode = 'P0001';
  end if;
  v_order := public.apply_order_status(p_order_id, p_to, 'manual', (select auth.uid()), p_note);
  if p_to = 'cancelled' then
    update public.orders set cancel_reason = coalesce(p_reason, cancel_reason, 'otro'), next_contact_at = null
    where id = p_order_id returning * into v_order;
  elsif p_to in ('failed_delivery', 'returned') then
    update public.orders set failure_reason = coalesce(p_reason, failure_reason, 'otro')
    where id = p_order_id returning * into v_order;
  elsif p_to = 'confirmed' then
    update public.orders set next_contact_at = null where id = p_order_id returning * into v_order;
  end if;
  return v_order;
end;
$$;

-- Liquidación: lo entregado menos los envíos, y también lo que el courier cobra por los envíos fallidos
create or replace function public.settle_orders(p_store_id uuid, p_order_ids uuid[], p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_ids uuid[];
  v_failed uuid[];
  v_settlement uuid;
  v_gross numeric(14, 2);
  v_shipping numeric(14, 2);
  v_failed_cost numeric(14, 2);
  v_couriers text[];
  v_count integer;
begin
  if not public.is_store_owner(p_store_id) then
    raise exception 'Solo el dueño liquida' using errcode = '42501';
  end if;
  select array_agg(o.id), coalesce(sum(o.balance_due), 0), coalesce(sum(o.shipping_cost), 0)
  into v_ids, v_gross, v_shipping
  from public.orders o
  where o.store_id = p_store_id and o.id = any (p_order_ids)
    and o.zone = 'lima' and o.status = 'delivered' and o.settled_at is null;
  -- Envíos fallidos de Lima: el courier igual cobra su envío (y la devolución)
  select array_agg(o.id), coalesce(sum(public.order_logistics_cost(o.status, o.shipped_at, o.shipping_cost, o.return_shipments)), 0)
  into v_failed, v_failed_cost
  from public.orders o
  where o.store_id = p_store_id and o.id = any (p_order_ids)
    and o.zone = 'lima' and o.status in ('failed_delivery', 'returned') and o.shipped_at is not null and o.settled_at is null;
  if v_ids is null and v_failed is null then
    raise exception 'Ninguno de esos pedidos está pendiente de liquidar' using errcode = 'P0001';
  end if;
  select array_agg(distinct coalesce(o.courier_id, '')) into v_couriers
  from public.orders o where o.id = any (coalesce(v_ids, '{}') || coalesce(v_failed, '{}'));
  v_count := coalesce(array_length(v_ids, 1), 0) + coalesce(array_length(v_failed, 1), 0);
  v_shipping := v_shipping + v_failed_cost;

  insert into public.courier_settlements (store_id, courier_id, order_count, gross, shipping, net, note)
  values (p_store_id, case when array_length(v_couriers, 1) = 1 then nullif(v_couriers[1], '') else 'varios' end,
          v_count, v_gross, v_shipping, v_gross - v_shipping, nullif(trim(p_note), ''))
  returning id into v_settlement;

  update public.orders set settled_at = now(), settlement_id = v_settlement
  where id = any (coalesce(v_ids, '{}') || coalesce(v_failed, '{}'));
  foreach v_id in array coalesce(v_ids, '{}') loop
    perform public.apply_order_status(v_id, 'collected', 'manual', (select auth.uid()), 'Liquidado con el courier');
  end loop;

  return jsonb_build_object('settlement_id', v_settlement, 'orders', v_count, 'gross', v_gross, 'shipping', v_shipping, 'net', v_gross - v_shipping);
end;
$$;

create or replace function public.undo_settlement(p_settlement_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_store uuid;
  v_count integer;
begin
  select store_id into v_store from public.courier_settlements where id = p_settlement_id;
  if v_store is null or not public.is_store_owner(v_store) then
    raise exception 'Liquidación no encontrada' using errcode = 'P0002';
  end if;
  insert into public.order_status_history (store_id, order_id, from_status, to_status, source, changed_by, note)
  select o.store_id, o.id, o.status, 'delivered', 'manual', (select auth.uid()), 'Liquidación anulada'
  from public.orders o where o.settlement_id = p_settlement_id and o.status = 'collected';
  update public.orders set status = 'delivered', collected_at = null, settled_at = null, settlement_id = null
  where settlement_id = p_settlement_id and status = 'collected';
  get diagnostics v_count = row_count;
  -- Los envíos fallidos de esa liquidación vuelven a quedar pendientes
  update public.orders set settled_at = null, settlement_id = null where settlement_id = p_settlement_id;
  delete from public.courier_settlements where id = p_settlement_id;
  return v_count;
end;
$$;

-- Costo de envío escrito a mano (aunque sea 0): el sistema ya no lo reemplaza por el del courier
alter table public.orders add column shipping_cost_set_at timestamptz;
grant update (shipping_cost_set_at) on public.orders to authenticated;

create or replace function public.orders_keep_manual_values()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.shipping_cost_set_at is not null
     and new.shipping_cost_set_at is not distinct from old.shipping_cost_set_at
     and new.shipping_cost is distinct from old.shipping_cost then
    new.shipping_cost := old.shipping_cost;
  end if;
  -- Cancelado: sale del lote exportado para poder exportarlo de nuevo si se reactiva
  if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    new.exported_at := null;
    new.export_batch_id := null;
  end if;
  return new;
end;
$$;
drop trigger if exists orders_keep_manual_values on public.orders;
create trigger orders_keep_manual_values before update on public.orders
  for each row execute function public.orders_keep_manual_values();

-- Gasto de Meta escrito a mano o importado: no se suma en los días que ya trae la sincronización de Meta
create or replace function public.expense_counts(p_store_id uuid, p_category public.expense_category, p_source text, p_date date)
returns boolean
language sql
stable
set search_path = ''
as $$
  select not (
    p_category = 'meta_ads' and p_source <> 'meta_sync'
    and exists (select 1 from public.expenses s where s.store_id = p_store_id and s.source = 'meta_sync' and s.expense_date = p_date)
  );
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
            and public.expense_counts(x.store_id, x.category, x.source, x.expense_date)
          group by x.category
        ) c
      ), '{}'::jsonb)
    )
    from public.expenses e
    where e.store_id = p_store_id and e.expense_date between p_from and p_to
      and public.expense_counts(e.store_id, e.category, e.source, e.expense_date)
  );
end;
$$;

-- Rendimiento por campaña: el gasto de Gastos (con ID de campaña) entra cuando Meta no trae ese día
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
    ins_raw as (
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
      union all
      select e.campaign_id, sum(e.amount_pen), 0, 0, 0, 0
      from public.expenses e
      where p_level = 'campaign' and e.store_id = p_store_id and e.campaign_id is not null
        and e.category in ('meta_ads', 'tiktok_ads', 'google_ads') and e.source <> 'meta_sync'
        and e.expense_date between p_from_date and p_to_date
        and not (e.category = 'meta_ads' and exists (
          select 1 from public.meta_insights_daily i2 where i2.store_id = p_store_id and i2.date = e.expense_date))
      group by e.campaign_id
    ),
    ins as (
      select key, sum(ad_spend) as ad_spend, sum(impressions) as impressions, sum(reach) as reach, sum(clicks) as clicks, sum(results) as results
      from ins_raw group by key
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

-- Productos: cada pedido cuenta para su producto principal (no para el adicional del formulario)
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
        public.order_logistics_cost(ord.status, ord.shipped_at, ord.shipping_cost, ord.return_shipments, ord.packaging_cost) as logistics_cost
      from public.orders ord
      join public.order_items oi on oi.order_id = ord.id
      where ord.store_id = p_store_id and ord.created_at >= p_from and ord.created_at < p_to
      order by ord.id, (oi.kind = 'main') desc, oi.created_at, oi.id
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

-- Filtro por producto: el producto principal del pedido (igual que en Rendimiento → Productos)
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
      select 1 from public.order_items i where i.order_id = p_order_id and i.product_id::text = p_key and i.kind = 'main')
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

-- Embudo: solo pedidos que vinieron de una landing (los manuales o de WhatsApp no tienen visita)
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
        and ord.landing_page_id is not null
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

-- Pedido público: guarda la versión de precio que vio el cliente y no sobrescribe los datos de un cliente existente
create or replace function public.create_cod_order(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_landing public.landing_pages;
  v_store public.stores;
  v_settings public.store_settings;
  v_product public.products;
  v_offer public.product_offers;
  v_district public.ubigeo_districts;
  v_province public.ubigeo_provinces;
  v_department public.ubigeo_departments;
  v_customer_id uuid;
  v_order public.orders;
  v_existing public.orders;
  v_order_number integer;
  v_shipping numeric(12, 2);
  v_subtotal numeric(12, 2);
  v_total numeric(12, 2);
  v_advance numeric(12, 2);
  v_cost numeric(12, 2);
  v_phone text := p ->> 'phone';
  v_email text := nullif(lower(trim(coalesce(p ->> 'email', ''))), '');
  v_idem text := nullif(p ->> 'idempotency_key', '');
  v_first text := trim(p ->> 'first_name');
  v_last text := nullif(trim(coalesce(p ->> 'last_name', '')), '');
  v_dup boolean;
  v_selected text[];
  v_bumps jsonb := '[]'::jsonb;
  v_item jsonb;
  v_bump_product public.products;
  v_bump_price numeric(12, 2);
  v_bump_cost numeric(12, 2);
  a jsonb := coalesce(p -> 'attribution', '{}'::jsonb);
  -- Prueba A/B de precio (settings.price_test de la landing)
  v_variant text;
  v_price_b numeric(12, 2);
begin
  -- Landing publicada + tienda activa
  select * into v_landing from public.landing_pages
  where id = (p ->> 'landing_page_id')::uuid and status = 'published';
  if not found then
    raise exception 'Landing no disponible' using errcode = 'P0002';
  end if;

  select * into v_store from public.stores where id = v_landing.store_id and status = 'active';
  if not found then
    raise exception 'Tienda no disponible' using errcode = 'P0002';
  end if;
  select * into v_settings from public.store_settings where store_id = v_store.id;

  -- Idempotencia: el mismo envío del formulario devuelve el mismo pedido
  if v_idem is not null then
    select * into v_existing from public.orders where store_id = v_store.id and idempotency_key = v_idem;
    if found then
      return jsonb_build_object('order_id', v_existing.id, 'order_number', v_existing.order_number,
                                'total', v_existing.total, 'duplicate_submit', true);
    end if;
  end if;

  select * into v_product from public.products where id = v_landing.product_id and status = 'active';
  if not found then
    raise exception 'Producto no disponible' using errcode = 'P0002';
  end if;

  select * into v_offer from public.product_offers
  where id = (p ->> 'offer_id')::uuid and product_id = v_product.id and is_active;
  if not found then
    raise exception 'Oferta no válida' using errcode = 'P0001';
  end if;

  -- Prueba de precio: la versión B cobra el precio B de la oferta (definido en la landing, nunca el que mande el navegador)
  if coalesce((v_landing.settings -> 'price_test' ->> 'enabled')::boolean, false) then
    v_variant := case when p ->> 'price_variant' = 'B' then 'B' else 'A' end;
    if v_variant = 'B' then
      v_price_b := nullif(v_landing.settings -> 'price_test' -> 'offers' ->> v_offer.id::text, '')::numeric;
      -- Oferta sin precio B: se cobra el normal, pero el pedido cuenta para la versión B que vio el cliente
      if v_price_b is not null and v_price_b > 0 and v_price_b <= 100000 then
        v_offer.price := v_price_b;
      end if;
    end if;
  end if;

  select * into v_district from public.ubigeo_districts where code = p ->> 'district_code';
  if not found then
    raise exception 'Distrito no válido' using errcode = 'P0001';
  end if;
  select * into v_province from public.ubigeo_provinces where code = v_district.province_code;
  select * into v_department from public.ubigeo_departments where code = v_province.department_code;

  if v_phone is null or v_phone !~ '^51[0-9]{9}$' then
    raise exception 'Teléfono no válido' using errcode = 'P0001';
  end if;
  if v_first is null or char_length(v_first) < 2 then
    raise exception 'Nombre no válido' using errcode = 'P0001';
  end if;
  if coalesce(trim(p ->> 'address'), '') = '' then
    raise exception 'Dirección requerida' using errcode = 'P0001';
  end if;
  if v_email is not null and (char_length(v_email) > 200 or v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$') then
    raise exception 'Correo no válido' using errcode = 'P0001';
  end if;

  -- Order bumps marcados: precio y producto salen de la landing publicada, nunca del navegador
  if jsonb_typeof(p -> 'bumps') = 'array' then
    select array_agg(x) into v_selected from (select jsonb_array_elements_text(p -> 'bumps') as x limit 10) s;
  end if;
  if v_selected is not null then
    for v_item in
      select it
      from jsonb_array_elements(coalesce(v_landing.published_content -> 'form_blocks', '[]'::jsonb)) fb,
           jsonb_array_elements(case when fb ->> 'type' = 'form_bumps' then coalesce(fb -> 'items', '[]'::jsonb) else '[]'::jsonb end) it
      where it ->> 'id' = any (v_selected)
    loop
      v_bump_price := greatest(coalesce((v_item ->> 'price')::numeric, 0), 0);
      v_bump_cost := greatest(coalesce((v_item ->> 'cost')::numeric, 0), 0);
      v_bump_product := null;
      if nullif(coalesce(v_item ->> 'productId', v_item ->> 'product_id'), '') is not null then
        select * into v_bump_product from public.products
        where id = (coalesce(v_item ->> 'productId', v_item ->> 'product_id'))::uuid and store_id = v_store.id and status = 'active';
        if not found then
          continue; -- producto ya no disponible: no se cobra
        end if;
        v_bump_cost := v_bump_product.cost;
      end if;
      v_bumps := v_bumps || jsonb_build_object(
        'product_id', v_bump_product.id,
        'name', left(coalesce(nullif(v_item ->> 'name', ''), v_bump_product.name, 'Adicional'), 160),
        'price', v_bump_price,
        'cost', v_bump_cost
      );
    end loop;
  end if;

  -- Montos: Lima Metropolitana (1501) y Callao (0701) pagan envío Lima
  v_shipping := case when v_province.code in ('1501', '0701')
                     then v_settings.shipping_lima else v_settings.shipping_province end;
  v_subtotal := v_offer.price + coalesce((select sum((b ->> 'price')::numeric) from jsonb_array_elements(v_bumps) b), 0);
  v_cost := v_product.cost * v_offer.quantity + coalesce((select sum((b ->> 'cost')::numeric) from jsonb_array_elements(v_bumps) b), 0);
  v_total := v_subtotal + v_shipping;
  v_advance := least(v_settings.advance_amount, v_total);

  -- Cliente (por teléfono dentro de la tienda)
  insert into public.customers as c (store_id, first_name, last_name, phone, whatsapp, dni, email, address, reference, district_code)
  values (v_store.id, v_first, v_last, v_phone, nullif(p ->> 'whatsapp', ''), nullif(p ->> 'dni', ''), v_email,
          trim(p ->> 'address'), nullif(trim(coalesce(p ->> 'reference', '')), ''), v_district.code)
  on conflict (store_id, phone) do update set
    -- Solo completa lo que falta: un formulario público no cambia los datos de un cliente que ya existe
    first_name = coalesce(nullif(c.first_name, ''), excluded.first_name),
    last_name = coalesce(c.last_name, excluded.last_name),
    whatsapp = coalesce(c.whatsapp, excluded.whatsapp),
    dni = coalesce(c.dni, excluded.dni),
    email = coalesce(c.email, excluded.email),
    address = coalesce(nullif(c.address, ''), excluded.address),
    reference = coalesce(c.reference, excluded.reference),
    district_code = coalesce(c.district_code, excluded.district_code)
  returning id into v_customer_id;

  -- Posible duplicado: mismo teléfono y producto en los últimos 30 min
  select exists (
    select 1 from public.orders o
    join public.order_items oi on oi.order_id = o.id
    where o.store_id = v_store.id and o.customer_phone = v_phone
      and oi.product_id = v_product.id and o.created_at > now() - interval '30 minutes'
  ) into v_dup;

  -- Correlativo por tienda
  update public.stores set next_order_number = next_order_number + 1
  where id = v_store.id
  returning next_order_number - 1 into v_order_number;

  insert into public.orders (
    store_id, order_number, customer_id, landing_page_id, status,
    subtotal, shipping_charged, total, advance_amount, balance_due,
    product_cost_total, shipping_cost,
    customer_name, customer_phone, customer_email,
    department_code, department_name, province_code, province_name, district_code, district_name,
    address, reference, dni, delivery_method, customer_notes,
    idempotency_key, is_possible_duplicate
  ) values (
    v_store.id, v_order_number, v_customer_id, v_landing.id, 'new',
    v_subtotal, v_shipping, v_total, v_advance, v_total - v_advance,
    v_cost, 0,
    trim(v_first || ' ' || coalesce(v_last, '')), v_phone, v_email,
    v_department.code, v_department.name, v_province.code, v_province.name, v_district.code, v_district.name,
    trim(p ->> 'address'), nullif(trim(coalesce(p ->> 'reference', '')), ''), nullif(p ->> 'dni', ''),
    nullif(p ->> 'delivery_method', ''), nullif(trim(coalesce(p ->> 'notes', '')), ''),
    v_idem, v_dup
  )
  returning * into v_order;

  insert into public.order_items (store_id, order_id, product_id, offer_id, product_name, offer_name, quantity, line_price, unit_cost, kind)
  values (v_store.id, v_order.id, v_product.id, v_offer.id, v_product.name, v_offer.name, v_offer.quantity, v_offer.price, v_product.cost, 'main');

  insert into public.order_items (store_id, order_id, product_id, product_name, quantity, line_price, unit_cost, kind)
  select v_store.id, v_order.id, nullif(b ->> 'product_id', '')::uuid, b ->> 'name', 1, (b ->> 'price')::numeric, (b ->> 'cost')::numeric, 'bump'
  from jsonb_array_elements(v_bumps) b;

  insert into public.order_status_history (store_id, order_id, from_status, to_status, source)
  values (v_store.id, v_order.id, null, 'new', 'system');

  insert into public.order_attribution (
    order_id, store_id, utm_source, utm_medium, utm_campaign, utm_content, utm_term,
    fbclid, fbc, fbp, campaign_id, adset_id, ad_id, landing_page_id, referrer, landing_url,
    client_ip, user_agent, price_variant
  ) values (
    v_order.id, v_store.id,
    left(a ->> 'utm_source', 255), left(a ->> 'utm_medium', 255), left(a ->> 'utm_campaign', 255),
    left(a ->> 'utm_content', 255), left(a ->> 'utm_term', 255),
    left(a ->> 'fbclid', 512), left(a ->> 'fbc', 600), left(a ->> 'fbp', 255),
    left(a ->> 'campaign_id', 64), left(a ->> 'adset_id', 64), left(a ->> 'ad_id', 64),
    v_landing.id, left(a ->> 'referrer', 1000), left(a ->> 'landing_url', 2000),
    nullif(p ->> 'client_ip', '')::inet, left(p ->> 'user_agent', 1000), v_variant
  );

  return jsonb_build_object('order_id', v_order.id, 'order_number', v_order.order_number,
                            'total', v_order.total, 'duplicate_submit', false,
                            'bumps', jsonb_array_length(v_bumps));
end;
$$;

-- Quita una clave en todo un JSON (para no publicar costos)
create or replace function public.jsonb_strip_key(p_json jsonb, p_key text)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case jsonb_typeof(p_json)
    when 'object' then (
      select coalesce(jsonb_object_agg(e.key, public.jsonb_strip_key(e.value, p_key)), '{}'::jsonb)
      from jsonb_each(p_json) e where e.key <> p_key)
    when 'array' then (
      select coalesce(jsonb_agg(public.jsonb_strip_key(a.value, p_key) order by a.ord), '[]'::jsonb)
      from jsonb_array_elements(p_json) with ordinality as a(value, ord))
    else p_json
  end;
$$;

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
      'content', public.jsonb_strip_key(l.published_content, 'cost'),
      'settings', jsonb_build_object(
        'angle', l.settings ->> 'angle',
        -- Prueba de precio activa: precios B por oferta (la landing reparte las visitas 50/50)
        'price_test', case when coalesce((l.settings -> 'price_test' ->> 'enabled')::boolean, false) then l.settings -> 'price_test' end
      ),
      'published_at', l.published_at,
      'ab_variants', case when coalesce((l.settings -> 'ab' ->> 'enabled')::boolean, false) then (
        select jsonb_agg(jsonb_build_object('slug', v.slug, 'weight', greatest(least(coalesce((x ->> 'weight')::integer, 0), 100), 0)))
        from jsonb_array_elements(coalesce(l.settings -> 'ab' -> 'variants', '[]'::jsonb)) x
        join public.landing_pages v
          on v.id::text = x ->> 'landing_id' and v.store_id = l.store_id and v.status = 'published'
      ) end
    ),
    'store', jsonb_build_object(
      'id', s.id,
      'slug', s.slug,
      'name', s.name,
      'currency', s.currency,
      'country', s.country,
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
    'tiktok', jsonb_build_object(
      'pixel_code', case when ts.enabled then ts.pixel_code else null end
    ),
    'product', jsonb_build_object(
      'id', p.id,
      'name', p.name,
      'description', p.description,
      'price', p.price,
      'compare_at_price', p.compare_at_price,
      'variant_label', p.variant_label,
      'variants', coalesce((
        select jsonb_agg(jsonb_build_object('id', v.id, 'name', v.name, 'available', v.stock is null or v.stock > 0) order by v.position, v.name)
        from public.product_variants v where v.product_id = p.id and v.is_active
      ), '[]'::jsonb),
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
  left join public.store_tiktok_settings ts on ts.store_id = s.id
  join public.products p on p.id = l.product_id
  where s.slug = lower(p_store_slug)
    and l.slug = lower(p_slug)
    and l.status = 'published'
    and s.status = 'active'
    and p.status = 'active';
$$;

-- Imágenes y logos de la tienda: solo el dueño las cambia o borra (el personal no administra el catálogo)
drop policy if exists "store-assets: miembros suben" on storage.objects;
drop policy if exists "store-assets: miembros actualizan" on storage.objects;
drop policy if exists "store-assets: miembros eliminan" on storage.objects;
create policy "store-assets: dueños suben"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'store-assets' and public.is_store_owner(public.storage_path_store_id(name)));
create policy "store-assets: dueños actualizan"
  on storage.objects for update to authenticated
  using (bucket_id = 'store-assets' and public.is_store_owner(public.storage_path_store_id(name)))
  with check (bucket_id = 'store-assets' and public.is_store_owner(public.storage_path_store_id(name)));
create policy "store-assets: dueños eliminan"
  on storage.objects for delete to authenticated
  using (bucket_id = 'store-assets' and public.is_store_owner(public.storage_path_store_id(name)));

-- Comprobantes: el personal solo borra los que no están verificados (el dueño, cualquiera)
drop policy if exists "order-receipts: miembros eliminan" on storage.objects;
create policy "order-receipts: se eliminan si no están verificados"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'order-receipts' and public.is_store_member(public.storage_path_store_id(name))
    and (
      public.is_store_owner(public.storage_path_store_id(name))
      or not exists (select 1 from public.order_payments p where p.receipt_path = name and p.verified_at is not null)
    )
  );

-- Asignar pedidos solo con assign_orders (valida que la persona sea del equipo)
revoke update (assigned_to) on public.orders from authenticated;
