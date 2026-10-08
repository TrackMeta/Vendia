-- =====================================================================
-- Vendia — Bloque 7: operación y equipo (ideas de Kontrol)
--  · Contadores calculados en la base (sin el corte de 1000 filas).
--  · Equipo: color por persona, comisión por pedido confirmado (se anula si
--    no se entrega), pagos de comisiones y métricas por confirmador.
--  · Costo de embalaje por unidad dentro de la utilidad.
--  · Variantes (talla, color…) con stock propio.
--  · Liquidación con el courier de Lima: cuánto te debe cada uno.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Contadores (antes se bajaban todas las filas para contarlas)
-- ---------------------------------------------------------------------
create or replace function public.order_status_counts(p_store_id uuid, p_zone text default null)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when public.is_store_member(p_store_id) then coalesce((
    select jsonb_object_agg(s.status, s.n)
    from (
      select o.status::text as status, count(*) as n
      from public.orders o
      where o.store_id = p_store_id and (p_zone is null or o.zone = p_zone)
      group by o.status
    ) s
  ), '{}'::jsonb) else '{}'::jsonb end;
$$;
grant execute on function public.order_status_counts(uuid, text) to authenticated;

create or replace function public.logistics_counts(p_store_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when public.is_store_member(p_store_id) then (
    select jsonb_build_object(
      'confirmar', count(*) filter (where o.status::text in ('new', 'pending_confirmation')),
      'despachar', count(*) filter (where o.status::text in ('confirmed', 'preparing')),
      'en_camino', count(*) filter (where o.status::text in ('shipped', 'out_for_delivery', 'at_agency')
                                       or (o.status::text = 'collected' and o.zone = 'provincia' and o.delivered_at is null))
    )
    from public.orders o where o.store_id = p_store_id
  ) else '{}'::jsonb end;
$$;
grant execute on function public.logistics_counts(uuid) to authenticated;

create or replace function public.abandoned_status_counts(p_store_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when public.is_store_member(p_store_id) then coalesce((
    select jsonb_object_agg(s.status, s.n)
    from (select a.status, count(*) as n from public.abandoned_checkouts a where a.store_id = p_store_id group by a.status) s
  ), '{}'::jsonb) else '{}'::jsonb end;
$$;
grant execute on function public.abandoned_status_counts(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 2. Equipo: color y comisión por persona
-- ---------------------------------------------------------------------
alter table public.store_members
  add column color text check (color is null or color ~ '^#[0-9a-fA-F]{6}$'),
  add column commission_lima numeric(10, 2) not null default 0 check (commission_lima >= 0 and commission_lima <= 10000),
  add column commission_province numeric(10, 2) not null default 0 check (commission_province >= 0 and commission_province <= 10000);

create or replace function public.update_member_settings(
  p_store_id uuid, p_user_id uuid, p_color text, p_commission_lima numeric, p_commission_province numeric
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_store_owner(p_store_id) then
    raise exception 'Solo el dueño puede cambiar esto' using errcode = '42501';
  end if;
  update public.store_members set
    color = nullif(p_color, ''),
    commission_lima = greatest(coalesce(p_commission_lima, 0), 0),
    commission_province = greatest(coalesce(p_commission_province, 0), 0)
  where store_id = p_store_id and user_id = p_user_id;
  if not found then
    raise exception 'Esa persona no es de tu equipo' using errcode = 'P0002';
  end if;
end;
$$;
grant execute on function public.update_member_settings(uuid, uuid, text, numeric, numeric) to authenticated;

-- El equipo ahora trae color y comisiones (las comisiones solo las ve el dueño)
create or replace function public.get_store_team(p_store_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when public.is_store_member(p_store_id) then coalesce((
    select jsonb_agg(jsonb_build_object(
      'user_id', m.user_id,
      'email', u.email,
      'full_name', pr.full_name,
      'role', m.role,
      'joined_at', m.created_at,
      'color', m.color,
      'commission_lima', case when public.is_store_owner(p_store_id) or m.user_id = (select auth.uid()) then m.commission_lima end,
      'commission_province', case when public.is_store_owner(p_store_id) or m.user_id = (select auth.uid()) then m.commission_province end
    ) order by (m.role = 'owner') desc, m.created_at)
    from public.store_members m
    join auth.users u on u.id = m.user_id
    left join public.profiles pr on pr.id = m.user_id
    where m.store_id = p_store_id
  ), '[]'::jsonb) else '[]'::jsonb end;
$$;
grant execute on function public.get_store_team(uuid) to authenticated;

-- Quién confirmó, su comisión (foto al confirmar) y el embalaje del pedido
alter table public.orders
  add column confirmed_by uuid references auth.users (id) on delete set null,
  add column commission_amount numeric(10, 2) not null default 0 check (commission_amount >= 0),
  add column packaging_cost numeric(12, 2) not null default 0 check (packaging_cost >= 0),
  add column settled_at timestamptz,
  add column settlement_id uuid;
create index orders_confirmed_by_idx on public.orders (store_id, confirmed_by) where confirmed_by is not null;
grant update (packaging_cost) on public.orders to authenticated;

-- Embalaje por unidad (bolsa, caja, cinta…)
alter table public.store_settings
  add column packaging_cost numeric(10, 2) not null default 0 check (packaging_cost >= 0 and packaging_cost <= 1000);
grant update (packaging_cost) on public.store_settings to authenticated;

create table public.commission_payments (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  amount numeric(10, 2) not null check (amount > 0 and amount <= 1000000),
  paid_on date not null default ((now() at time zone 'America/Lima')::date),
  note text check (note is null or char_length(note) <= 300),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index commission_payments_idx on public.commission_payments (store_id, user_id, paid_on desc);

alter table public.commission_payments enable row level security;
revoke all on public.commission_payments from anon, authenticated;
grant select, delete on public.commission_payments to authenticated;
grant insert (store_id, user_id, amount, paid_on, note) on public.commission_payments to authenticated;
create policy "commission_payments: dueño ve todo, cada uno lo suyo" on public.commission_payments
  for select to authenticated using (public.is_store_owner(store_id) or user_id = (select auth.uid()));
create policy "commission_payments: dueño registra" on public.commission_payments
  for insert to authenticated with check (
    public.is_store_owner(store_id)
    and exists (select 1 from public.store_members m where m.store_id = commission_payments.store_id and m.user_id = commission_payments.user_id)
  );
create policy "commission_payments: dueño elimina" on public.commission_payments
  for delete to authenticated using (public.is_store_owner(store_id));

-- Comisiones: generada (pedidos confirmados que siguen vivos o se entregaron) − pagada = pendiente.
-- Si el pedido se cancela, no se entrega o se devuelve, su comisión queda anulada.
create or replace function public.get_commissions(p_store_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when public.is_store_member(p_store_id) then coalesce((
    select jsonb_agg(row_to_json(r)::jsonb order by r.generated desc)
    from (
      select
        m.user_id,
        coalesce(pr.full_name, u.email) as name,
        m.color,
        m.commission_lima,
        m.commission_province,
        coalesce((select sum(o.commission_amount) from public.orders o
                  where o.store_id = p_store_id and o.confirmed_by = m.user_id
                    and o.status::text not in ('cancelled', 'failed_delivery', 'returned')), 0) as generated,
        coalesce((select count(*) from public.orders o
                  where o.store_id = p_store_id and o.confirmed_by = m.user_id
                    and o.status::text not in ('cancelled', 'failed_delivery', 'returned')), 0) as generated_orders,
        coalesce((select sum(o.commission_amount) from public.orders o
                  where o.store_id = p_store_id and o.confirmed_by = m.user_id
                    and o.status::text in ('cancelled', 'failed_delivery', 'returned')), 0) as annulled,
        coalesce((select sum(cp.amount) from public.commission_payments cp where cp.store_id = p_store_id and cp.user_id = m.user_id), 0) as paid,
        (select max(cp.paid_on) from public.commission_payments cp where cp.store_id = p_store_id and cp.user_id = m.user_id) as last_paid_on
      from public.store_members m
      join auth.users u on u.id = m.user_id
      left join public.profiles pr on pr.id = m.user_id
      where m.store_id = p_store_id
        and (public.is_store_owner(p_store_id) or m.user_id = (select auth.uid()))
    ) r
  ), '[]'::jsonb) else '[]'::jsonb end;
$$;
grant execute on function public.get_commissions(uuid) to authenticated;

-- Métricas por confirmador (por cohorte: pedidos CREADOS en el rango)
create or replace function public.get_team_metrics(p_store_id uuid, p_from timestamptz, p_to timestamptz)
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
  return coalesce((
    with o as (
      select ord.*, public.order_is_sale(ord.status, ord.zone, ord.delivered_at, ord.collected_at, v_mode) as is_sale,
        (select a.created_by from public.order_contact_attempts a where a.order_id = ord.id order by a.id limit 1) as first_contact_by,
        (select a.created_at from public.order_contact_attempts a where a.order_id = ord.id order by a.id limit 1) as first_contact_at
      from public.orders ord
      where ord.store_id = p_store_id and ord.created_at >= p_from and ord.created_at < p_to
    )
    select jsonb_agg(row_to_json(r)::jsonb order by r.confirmed desc)
    from (
      select
        m.user_id,
        coalesce(pr.full_name, u.email) as name,
        m.color,
        m.role,
        (select count(*) from o where o.assigned_to = m.user_id) as assigned,
        (select count(*) from o where o.confirmed_by = m.user_id
           or exists (select 1 from public.order_contact_attempts a where a.order_id = o.id and a.created_by = m.user_id)) as worked,
        (select count(*) from o where o.confirmed_by = m.user_id) as confirmed,
        (select count(*) from o where o.confirmed_by = m.user_id and o.is_sale) as sales,
        (select count(*) from o where o.confirmed_by = m.user_id and o.status::text in ('failed_delivery', 'returned')) as failed,
        (select count(*) from o where o.confirmed_by = m.user_id and o.status::text = 'cancelled') as cancelled_after,
        (select round(avg(extract(epoch from (o.first_contact_at - o.created_at)) / 60)::numeric, 1)
           from o where o.first_contact_by = m.user_id and o.first_contact_at is not null) as first_response_minutes
      from public.store_members m
      join auth.users u on u.id = m.user_id
      left join public.profiles pr on pr.id = m.user_id
      where m.store_id = p_store_id
        and (public.is_store_owner(p_store_id) or m.user_id = (select auth.uid()))
    ) r
  ), '[]'::jsonb);
end;
$$;
grant execute on function public.get_team_metrics(uuid, timestamptz, timestamptz) to authenticated;

-- ---------------------------------------------------------------------
-- 3. Variantes (talla, color…) con stock propio
-- ---------------------------------------------------------------------
alter table public.products
  add column variant_label text check (variant_label is null or char_length(variant_label) between 1 and 40);

create table public.product_variants (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  product_id uuid not null,
  name text not null check (char_length(name) between 1 and 60),
  sku text check (sku is null or char_length(sku) <= 64),
  stock integer check (stock is null or stock >= 0),
  position integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  foreign key (product_id, store_id) references public.products (id, store_id) on delete cascade,
  unique (product_id, name)
);
create index product_variants_product_idx on public.product_variants (product_id, position);

alter table public.product_variants enable row level security;
revoke all on public.product_variants from anon, authenticated;
grant select, insert, update, delete on public.product_variants to authenticated;
create policy "variants: miembros leen" on public.product_variants
  for select to authenticated using (public.is_store_member(store_id));
create policy "variants: dueño crea" on public.product_variants
  for insert to authenticated with check (public.is_store_owner(store_id));
create policy "variants: dueño edita" on public.product_variants
  for update to authenticated using (public.is_store_owner(store_id)) with check (public.is_store_owner(store_id));
create policy "variants: dueño elimina" on public.product_variants
  for delete to authenticated using (public.is_store_owner(store_id));

-- Qué variantes lleva cada línea: [{ variant_id, name, quantity }]
alter table public.order_items
  add column variant_breakdown jsonb not null default '[]'::jsonb check (jsonb_typeof(variant_breakdown) = 'array');

-- Stock: si la línea tiene variantes, se descuenta de cada variante; si no, del producto
create or replace function public.reserve_order_stock(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_left integer;
begin
  -- Productos sin variantes
  for r in
    select oi.product_id, sum(oi.quantity)::integer as qty, max(oi.product_name) as name, max(oi.store_id::text)::uuid as store_id
    from public.order_items oi
    where oi.order_id = p_order_id and oi.product_id is not null and jsonb_array_length(oi.variant_breakdown) = 0
    group by oi.product_id
  loop
    update public.products p set stock = p.stock - r.qty
    where p.id = r.product_id and p.stock is not null and p.stock >= r.qty
    returning p.stock into v_left;
    if not found then
      if exists (select 1 from public.products p where p.id = r.product_id and p.stock is not null) then
        raise exception 'Sin stock suficiente de «%» (quedan %)', r.name,
          (select p.stock from public.products p where p.id = r.product_id) using errcode = 'P0001';
      end if;
      continue;
    end if;
    if v_left <= 3 then
      insert into public.notifications (store_id, type, title, body, link)
      values (r.store_id, 'low_stock', case when v_left = 0 then 'Sin stock: ' else 'Stock bajo: ' end || left(r.name, 150),
              'Quedan ' || v_left || ' unidades.', '/dashboard/productos/' || r.product_id);
    end if;
  end loop;

  -- Variantes
  for r in
    select (b ->> 'variant_id')::uuid as variant_id, sum((b ->> 'quantity')::integer)::integer as qty,
           max(oi.product_name) || ' · ' || max(b ->> 'name') as name, max(oi.store_id::text)::uuid as store_id, max(oi.product_id::text)::uuid as product_id
    from public.order_items oi, jsonb_array_elements(oi.variant_breakdown) b
    where oi.order_id = p_order_id
    group by 1
  loop
    update public.product_variants v set stock = v.stock - r.qty
    where v.id = r.variant_id and v.stock is not null and v.stock >= r.qty
    returning v.stock into v_left;
    if not found then
      if exists (select 1 from public.product_variants v where v.id = r.variant_id and v.stock is not null) then
        raise exception 'Sin stock suficiente de «%» (quedan %)', r.name,
          (select v.stock from public.product_variants v where v.id = r.variant_id) using errcode = 'P0001';
      end if;
      continue;
    end if;
    if v_left <= 3 then
      insert into public.notifications (store_id, type, title, body, link)
      values (r.store_id, 'low_stock', case when v_left = 0 then 'Sin stock: ' else 'Stock bajo: ' end || left(r.name, 150),
              'Quedan ' || v_left || ' unidades.', '/dashboard/productos/' || r.product_id);
    end if;
  end loop;
end;
$$;
revoke all on function public.reserve_order_stock(uuid) from public, anon, authenticated;

create or replace function public.release_order_stock(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.products p set stock = p.stock + x.qty
  from (
    select oi.product_id, sum(oi.quantity)::integer as qty
    from public.order_items oi
    where oi.order_id = p_order_id and oi.product_id is not null and jsonb_array_length(oi.variant_breakdown) = 0
    group by oi.product_id
  ) x
  where p.id = x.product_id and p.stock is not null;

  update public.product_variants v set stock = v.stock + x.qty
  from (
    select (b ->> 'variant_id')::uuid as variant_id, sum((b ->> 'quantity')::integer)::integer as qty
    from public.order_items oi, jsonb_array_elements(oi.variant_breakdown) b
    where oi.order_id = p_order_id
    group by 1
  ) x
  where v.id = x.variant_id and v.stock is not null;
end;
$$;
revoke all on function public.release_order_stock(uuid) from public, anon, authenticated;

-- Elegir o cambiar las variantes del producto principal (una por unidad).
-- La usan el formulario de la landing (servidor), el pedido manual y el confirmador.
create or replace function public.set_order_variants(p_order_id uuid, p_variant_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_item public.order_items;
  v_breakdown jsonb;
  v_valid integer;
  v_label text;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or ((select auth.uid()) is not null and not public.is_store_member(v_order.store_id)) then
    raise exception 'Pedido no encontrado' using errcode = 'P0002';
  end if;
  if v_order.status::text not in ('new', 'pending_confirmation', 'confirmed', 'preparing') then
    raise exception 'El pedido ya salió: no se pueden cambiar las variantes' using errcode = 'P0001';
  end if;
  select * into v_item from public.order_items where order_id = p_order_id and kind = 'main' order by created_at limit 1;
  if not found or v_item.product_id is null then
    raise exception 'El pedido no tiene producto' using errcode = 'P0001';
  end if;
  if coalesce(array_length(p_variant_ids, 1), 0) <> v_item.quantity then
    raise exception 'Elige % variante(s), una por unidad', v_item.quantity using errcode = 'P0001';
  end if;
  select count(*) into v_valid from unnest(p_variant_ids) x
  where exists (select 1 from public.product_variants v where v.id = x and v.product_id = v_item.product_id and v.is_active);
  if v_valid <> v_item.quantity then
    raise exception 'Hay variantes que no son de este producto' using errcode = 'P0001';
  end if;

  select jsonb_agg(jsonb_build_object('variant_id', v.id, 'name', v.name, 'quantity', c.n) order by v.position, v.name),
         string_agg(v.name || ' ×' || c.n, ', ' order by v.position, v.name)
  into v_breakdown, v_label
  from (select x as variant_id, count(*)::integer as n from unnest(p_variant_ids) x group by x) c
  join public.product_variants v on v.id = c.variant_id;

  -- Si el stock ya estaba descontado, se devuelve el anterior y se descuenta el nuevo
  if v_order.stock_reserved then
    perform public.release_order_stock(p_order_id);
  end if;
  update public.order_items set variant_breakdown = v_breakdown where id = v_item.id;
  if v_order.stock_reserved then
    perform public.reserve_order_stock(p_order_id);
  end if;

  insert into public.order_status_history (store_id, order_id, from_status, to_status, source, changed_by, note)
  values (v_order.store_id, v_order.id, v_order.status, v_order.status,
          case when (select auth.uid()) is null then 'system'::public.status_change_source else 'manual'::public.status_change_source end,
          (select auth.uid()), 'Variantes: ' || v_label);
  return jsonb_build_object('order_id', v_order.id, 'variants', v_breakdown);
end;
$$;
revoke all on function public.set_order_variants(uuid, uuid[]) from public, anon;
grant execute on function public.set_order_variants(uuid, uuid[]) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 4. Liquidación con el courier de Lima
--    El motorizado cobra en la puerta y luego te deposita lo cobrado menos su envío.
-- ---------------------------------------------------------------------
create table public.courier_settlements (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  courier_id text,
  order_count integer not null default 0,
  gross numeric(14, 2) not null default 0,
  shipping numeric(14, 2) not null default 0,
  net numeric(14, 2) not null default 0,
  note text check (note is null or char_length(note) <= 300),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (id, store_id)
);
create index courier_settlements_store_idx on public.courier_settlements (store_id, created_at desc);
alter table public.orders
  add constraint orders_settlement_fk foreign key (settlement_id, store_id)
  references public.courier_settlements (id, store_id) on delete set null (settlement_id);

alter table public.courier_settlements enable row level security;
revoke all on public.courier_settlements from anon, authenticated;
grant select on public.courier_settlements to authenticated;
create policy "settlements: dueño lee" on public.courier_settlements
  for select to authenticated using (public.is_store_owner(store_id));

create or replace function public.settle_orders(p_store_id uuid, p_order_ids uuid[], p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_ids uuid[];
  v_settlement uuid;
  v_gross numeric(14, 2);
  v_shipping numeric(14, 2);
  v_couriers text[];
begin
  if not public.is_store_owner(p_store_id) then
    raise exception 'Solo el dueño liquida' using errcode = '42501';
  end if;
  select array_agg(o.id), coalesce(sum(o.balance_due), 0), coalesce(sum(o.shipping_cost), 0), array_agg(distinct coalesce(o.courier_id, ''))
  into v_ids, v_gross, v_shipping, v_couriers
  from public.orders o
  where o.store_id = p_store_id and o.id = any (p_order_ids)
    and o.zone = 'lima' and o.status = 'delivered' and o.settled_at is null;
  if v_ids is null then
    raise exception 'Ninguno de esos pedidos está pendiente de liquidar' using errcode = 'P0001';
  end if;

  insert into public.courier_settlements (store_id, courier_id, order_count, gross, shipping, net, note)
  values (p_store_id, case when array_length(v_couriers, 1) = 1 then nullif(v_couriers[1], '') else 'varios' end,
          array_length(v_ids, 1), v_gross, v_shipping, v_gross - v_shipping, nullif(trim(p_note), ''))
  returning id into v_settlement;

  update public.orders set settled_at = now(), settlement_id = v_settlement where id = any (v_ids);
  foreach v_id in array v_ids loop
    perform public.apply_order_status(v_id, 'collected', 'manual', (select auth.uid()), 'Liquidado con el courier');
  end loop;

  return jsonb_build_object('settlement_id', v_settlement, 'orders', array_length(v_ids, 1), 'gross', v_gross, 'shipping', v_shipping, 'net', v_gross - v_shipping);
end;
$$;
grant execute on function public.settle_orders(uuid, uuid[], text) to authenticated;

-- Anular una liquidación (si se marcó por error): los pedidos vuelven a «Entregado»
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
  delete from public.courier_settlements where id = p_settlement_id;
  return v_count;
end;
$$;
grant execute on function public.undo_settlement(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 5. Cambio de estado: + quién confirmó, su comisión y el embalaje
-- ---------------------------------------------------------------------
create or replace function public.apply_order_status(
  p_order_id uuid,
  p_to public.order_status,
  p_source public.status_change_source,
  p_actor uuid,
  p_note text
)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_from public.order_status;
  v_zone text;
  v_rank integer;
  v_now timestamptz := now();
  v_courier public.store_couriers;
  v_reserve boolean := false;
  v_release boolean := false;
  v_confirming boolean;
  v_member public.store_members;
  v_packaging numeric(10, 2);
  v_units integer;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'Pedido no encontrado' using errcode = 'P0002';
  end if;

  v_from := v_order.status;
  v_zone := v_order.zone;
  if not public.order_transition_allowed(v_from, p_to, v_zone) then
    raise exception 'No se puede pasar de % a %', v_from, p_to using errcode = 'P0001';
  end if;
  v_rank := public.order_status_rank(p_to, v_zone);
  v_confirming := v_rank is not null and v_rank >= 2 and v_order.confirmed_at is null;

  -- Stock: se descuenta al confirmar; se devuelve al cancelar o si no se entrega
  if v_rank is not null and v_rank >= 2 and not v_order.stock_reserved then
    perform public.reserve_order_stock(p_order_id);
    v_reserve := true;
  elsif p_to::text in ('cancelled', 'failed_delivery', 'returned') and v_order.stock_reserved then
    perform public.release_order_stock(p_order_id);
    v_release := true;
  end if;

  -- Courier predeterminado de la zona (si aún no tiene uno)
  select * into v_courier from public.store_couriers c
  where c.store_id = v_order.store_id
    and (c.courier_id = v_order.courier_id or (v_order.courier_id is null and c.zone = v_zone and c.is_default and c.enabled))
  order by (c.courier_id = v_order.courier_id) desc nulls last
  limit 1;

  -- Al confirmar: quién lo confirmó (comisión según la zona) y embalaje por unidad
  if v_confirming then
    if p_actor is not null then
      select * into v_member from public.store_members m where m.store_id = v_order.store_id and m.user_id = p_actor;
    end if;
    select s.packaging_cost into v_packaging from public.store_settings s where s.store_id = v_order.store_id;
    select coalesce(sum(oi.quantity), 0) into v_units from public.order_items oi where oi.order_id = p_order_id;
  end if;

  update public.orders o set
    status = p_to,
    stock_reserved = case when v_reserve then true when v_release then false else o.stock_reserved end,
    courier_id = case when v_rank >= 2 then coalesce(o.courier_id, v_courier.courier_id) else o.courier_id end,
    shipping_cost = case when v_rank >= 2 and o.shipping_cost = 0 then coalesce(v_courier.shipping_cost, 0) else o.shipping_cost end,
    return_shipments = case when p_to::text = 'failed_delivery' then coalesce(o.return_shipments, v_courier.return_shipments, 1) else o.return_shipments end,
    confirmed_by = case when v_confirming then coalesce(v_member.user_id, o.confirmed_by) else o.confirmed_by end,
    commission_amount = case
      when v_confirming and v_member.user_id is not null then
        case when v_zone = 'lima' then v_member.commission_lima else v_member.commission_province end
      else o.commission_amount end,
    packaging_cost = case when v_confirming and o.packaging_cost = 0 then coalesce(v_packaging, 0) * v_units else o.packaging_cost end,
    confirmed_at = case when v_rank >= 2 then coalesce(o.confirmed_at, v_now) else o.confirmed_at end,
    shipped_at   = case when v_rank >= 4 then coalesce(o.shipped_at, v_now) else o.shipped_at end,
    at_agency_at = case when v_zone = 'provincia' and v_rank >= 5 then coalesce(o.at_agency_at, v_now) else o.at_agency_at end,
    delivered_at = case when v_rank >= public.order_status_rank('delivered', v_zone) then coalesce(o.delivered_at, v_now) else o.delivered_at end,
    collected_at = case when v_rank >= public.order_status_rank('collected', v_zone) then coalesce(o.collected_at, v_now) else o.collected_at end,
    cancelled_at = case
      when p_to = 'cancelled' then v_now
      when v_order.status = 'cancelled' then null
      else o.cancelled_at end,
    failed_at    = case when p_to = 'failed_delivery' then v_now else o.failed_at end,
    returned_at  = case when p_to = 'returned' then v_now else o.returned_at end
  where o.id = p_order_id
  returning * into v_order;

  insert into public.order_status_history (store_id, order_id, from_status, to_status, source, changed_by, note)
  values (v_order.store_id, v_order.id, v_from, p_to, p_source, p_actor, nullif(trim(p_note), ''));

  return v_order;
end;
$$;
revoke all on function public.apply_order_status(uuid, public.order_status, public.status_change_source, uuid, text) from public, anon, authenticated;

-- Costo logístico: + embalaje de lo que salió
create or replace function public.order_logistics_cost(
  p_status public.order_status, p_shipped_at timestamptz, p_shipping_cost numeric, p_return_shipments smallint, p_packaging numeric
)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select public.order_logistics_cost(p_status, p_shipped_at, p_shipping_cost, p_return_shipments)
       + case when p_shipped_at is null then 0 else coalesce(p_packaging, 0) end;
$$;

-- ---------------------------------------------------------------------
-- 6. Estadísticas con embalaje y landing pública con variantes
--    (regeneradas desde su última versión; solo cambia lo indicado)
-- ---------------------------------------------------------------------
-- (desde 20261008001400_numeros_correctos.sql, + embalaje)
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
      'shipping_cost', coalesce(sum(public.order_logistics_cost(status, shipped_at, shipping_cost, return_shipments, packaging_cost)), 0)
    )
    from o
  );
end;
$$;

-- (desde 20261008001400_numeros_correctos.sql, + embalaje)
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
        public.order_logistics_cost(ord.status, ord.shipped_at, ord.shipping_cost, ord.return_shipments, ord.packaging_cost) as logistics_cost,
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

-- (desde 20261008001400_numeros_correctos.sql, + embalaje)
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

-- (desde 20261008001400_numeros_correctos.sql, + embalaje)
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
        public.order_logistics_cost(ord.status, ord.shipped_at, ord.shipping_cost, ord.return_shipments, ord.packaging_cost) as logistics_cost,
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

-- (desde 20261008001600_landing_ventas.sql, + embalaje)
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
          when 'angle' then coalesce(la.angle, '(pedido manual)')
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
    ad_landing as (
      select distinct on (x.ad_id) x.ad_id, x.landing_page_id
      from (
        select a.ad_id, ord.landing_page_id, count(*) as n
        from public.orders ord
        join public.order_attribution a on a.order_id = ord.id
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
          else coalesce(la.angle, '(anuncios sin pedidos)')
        end as key,
        sum(i.spend_pen) as ad_spend,
        sum(i.impressions) as impressions,
        sum(i.reach) as reach,
        sum(i.clicks) as clicks,
        sum(i.results) as results
      from public.meta_insights_daily i
      left join ad_landing al on p_level = 'angle' and al.ad_id = i.ad_id
      left join landing_angle la on la.id = al.landing_page_id
      where p_level in ('campaign', 'adset', 'ad', 'angle')
        and i.store_id = p_store_id and i.date between p_from_date and p_to_date
      group by 1
    ),
    visits as (
      select case when p_level = 'angle' then la.angle else e.landing_page_id::text end as key,
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

-- (desde 20261008001700_plataforma.sql, + variantes)
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
      'settings', jsonb_build_object('angle', l.settings ->> 'angle'),
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
