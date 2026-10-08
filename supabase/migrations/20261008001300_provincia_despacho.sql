-- =====================================================================
-- Vendia — Bloque 2: Provincia y despacho
--  · Estado «En agencia» y máquina de estados por zona
--      Lima:      … → Enviado → En reparto → Entregado → Cobrado
--      Provincia: … → Enviado → En agencia → Cobrado → Entregado
--  · Datos de envío: courier, agencia de destino/origen, número de orden,
--    clave de recojo, medidas y peso, costo de devolución (0/1/2 envíos)
--  · Couriers por tienda (catálogo ampliable en src/modules/couriers)
--  · Pagos con comprobante (adelanto y saldo) en un bucket privado
--  · Stock: se descuenta al confirmar y se devuelve al cancelar / no entregar
--  · Exportación a la plantilla del courier con reserva atómica y lotes
--  · Adelanto solo en provincia (Lima es contraentrega pura)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Nuevo estado. OJO: dentro de esta migración el valor nuevo solo se
--    usa como texto dentro de funciones PL/pgSQL (Postgres no permite usar
--    un valor de enum recién agregado en la misma transacción).
-- ---------------------------------------------------------------------
alter type public.order_status add value if not exists 'at_agency' after 'out_for_delivery';

-- ---------------------------------------------------------------------
-- 2. Columnas nuevas
-- ---------------------------------------------------------------------
alter table public.products
  add column package_size text not null default 'PAQUETE S' check (char_length(package_size) between 1 and 40),
  add column package_weight numeric(8, 2) not null default 1 check (package_weight >= 0),
  add column package_height numeric(8, 2) not null default 0 check (package_height >= 0),
  add column package_width numeric(8, 2) not null default 0 check (package_width >= 0),
  add column package_length numeric(8, 2) not null default 0 check (package_length >= 0);

alter table public.product_offers
  add column package_size text check (package_size is null or char_length(package_size) between 1 and 40),
  add column package_weight numeric(8, 2) check (package_weight is null or package_weight >= 0);

alter table public.orders
  add column courier_id text check (courier_id is null or courier_id ~ '^[a-z0-9_]{2,40}$'),
  add column agency_destination text check (agency_destination is null or char_length(agency_destination) <= 120),
  add column agency_origin text check (agency_origin is null or char_length(agency_origin) <= 120),
  add column courier_order_number text check (courier_order_number is null or char_length(courier_order_number) <= 60),
  add column pickup_key text check (pickup_key is null or char_length(pickup_key) <= 40),
  add column package_size text check (package_size is null or char_length(package_size) <= 40),
  add column package_weight numeric(8, 2) check (package_weight is null or package_weight >= 0),
  add column return_shipments smallint check (return_shipments is null or return_shipments between 0 and 2),
  add column stock_reserved boolean not null default false,
  add column at_agency_at timestamptz,
  add column exported_at timestamptz,
  add column export_batch_id uuid;

-- Lo que el equipo puede editar del envío (la tabla ya tiene RLS «miembros editan»)
grant update (
  courier_id, courier_name, tracking_code, agency_destination, agency_origin, courier_order_number,
  pickup_key, package_size, package_weight, return_shipments, dni
) on public.orders to authenticated;

create index orders_export_idx on public.orders (store_id, status) where exported_at is null;

-- Avisos de stock bajo
alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type in (
  'new_order', 'possible_duplicate', 'risky_customer', 'sequence_done', 'callback_due',
  'meta_failed', 'webhook_failed', 'team', 'low_stock'));

-- ---------------------------------------------------------------------
-- 3. Couriers por tienda
-- ---------------------------------------------------------------------
create table public.store_couriers (
  store_id uuid not null references public.stores (id) on delete cascade,
  courier_id text not null check (courier_id ~ '^[a-z0-9_]{2,40}$'),
  zone text not null check (zone in ('lima', 'provincia')),
  enabled boolean not null default true,
  is_default boolean not null default false,
  -- Valor sugerido del envío (cada pedido guarda el suyo y se puede editar)
  shipping_cost numeric(12, 2) not null default 0 check (shipping_cost >= 0),
  -- Cuántos envíos cobra cuando el pedido no se entrega (0, 1 o 2)
  return_shipments smallint not null default 1 check (return_shipments between 0 and 2),
  -- Shalom: agencia de origen predeterminada
  origin_agency text check (origin_agency is null or char_length(origin_agency) <= 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (store_id, courier_id)
);
create unique index store_couriers_default_idx on public.store_couriers (store_id, zone) where is_default;
create trigger store_couriers_updated_at before update on public.store_couriers
  for each row execute function public.set_updated_at();

alter table public.store_couriers enable row level security;
revoke all on public.store_couriers from anon, authenticated;
grant select, insert, update, delete on public.store_couriers to authenticated;
create policy "store_couriers: miembros leen" on public.store_couriers
  for select to authenticated using (public.is_store_member(store_id));
create policy "store_couriers: dueño crea" on public.store_couriers
  for insert to authenticated with check (public.is_store_owner(store_id));
create policy "store_couriers: dueño edita" on public.store_couriers
  for update to authenticated using (public.is_store_owner(store_id)) with check (public.is_store_owner(store_id));
create policy "store_couriers: dueño elimina" on public.store_couriers
  for delete to authenticated using (public.is_store_owner(store_id));

-- Couriers iniciales: Eva en Lima y Shalom en provincia
create or replace function public.seed_store_couriers()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.store_couriers (store_id, courier_id, zone, is_default, shipping_cost, return_shipments)
  values (new.id, 'eva', 'lima', true, 10, 1), (new.id, 'shalom', 'provincia', true, 15, 2)
  on conflict do nothing;
  return new;
end;
$$;
create trigger stores_seed_couriers after insert on public.stores
  for each row execute function public.seed_store_couriers();

insert into public.store_couriers (store_id, courier_id, zone, is_default, shipping_cost, return_shipments)
select s.id, c.courier_id, c.zone, true, c.cost, c.ret
from public.stores s
cross join (values ('eva', 'lima', 10::numeric, 1::smallint), ('shalom', 'provincia', 15::numeric, 2::smallint)) as c (courier_id, zone, cost, ret)
on conflict do nothing;

-- ---------------------------------------------------------------------
-- 4. Lotes de exportación
-- ---------------------------------------------------------------------
create table public.export_batches (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  courier_id text not null,
  origin_agency text,
  order_count integer not null default 0,
  marked_shipped boolean not null default false,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (id, store_id)
);
create index export_batches_store_idx on public.export_batches (store_id, created_at desc);

alter table public.orders
  add constraint orders_export_batch_fk foreign key (export_batch_id, store_id)
  references public.export_batches (id, store_id) on delete set null (export_batch_id);
create index orders_export_batch_idx on public.orders (export_batch_id) where export_batch_id is not null;

alter table public.export_batches enable row level security;
revoke all on public.export_batches from anon, authenticated;
grant select on public.export_batches to authenticated;
create policy "export_batches: miembros leen" on public.export_batches
  for select to authenticated using (public.is_store_member(store_id));

-- ---------------------------------------------------------------------
-- 5. Pagos con comprobante
-- ---------------------------------------------------------------------
create table public.order_payments (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  order_id uuid not null,
  kind text not null check (kind in ('advance', 'balance')),
  amount numeric(12, 2) not null check (amount > 0),
  method text not null check (method in ('yape', 'plin', 'transferencia', 'efectivo', 'otro')),
  paid_on date not null default ((now() at time zone 'America/Lima')::date),
  receipt_path text check (receipt_path is null or char_length(receipt_path) <= 300),
  note text check (note is null or char_length(note) <= 300),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  verified_by uuid references auth.users (id) on delete set null,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (order_id, store_id) references public.orders (id, store_id) on delete cascade
);
create index order_payments_order_idx on public.order_payments (order_id, created_at);

alter table public.order_payments enable row level security;
revoke all on public.order_payments from anon, authenticated;
grant select, delete on public.order_payments to authenticated;
grant insert (store_id, order_id, kind, amount, method, paid_on, receipt_path, note) on public.order_payments to authenticated;
create policy "order_payments: miembros leen" on public.order_payments
  for select to authenticated using (public.is_store_member(store_id));
create policy "order_payments: miembros registran" on public.order_payments
  for insert to authenticated with check (
    public.is_store_member(store_id)
    and (receipt_path is null or public.storage_path_store_id(receipt_path) = store_id)
  );
-- Un pago verificado ya no se borra (solo el dueño)
create policy "order_payments: borrar no verificados" on public.order_payments
  for delete to authenticated using (
    public.is_store_member(store_id) and (verified_at is null or public.is_store_owner(store_id))
  );

-- El adelanto del pedido es la suma de los adelantos registrados
create or replace function public.sync_order_advance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_id uuid := coalesce(new.order_id, old.order_id);
  v_paid numeric(12, 2);
  v_count integer;
  v_default numeric(12, 2);
begin
  select coalesce(sum(amount), 0), count(*) into v_paid, v_count
  from public.order_payments where order_id = v_order_id and kind = 'advance';

  if v_count = 0 then
    -- Sin adelantos registrados: vuelve al adelanto configurado (solo provincia)
    select case when o.zone = 'provincia' then coalesce(s.advance_amount, 0) else 0 end into v_default
    from public.orders o left join public.store_settings s on s.store_id = o.store_id
    where o.id = v_order_id;
    v_paid := coalesce(v_default, 0);
  end if;

  update public.orders o set
    advance_amount = least(v_paid, o.total),
    balance_due = o.total - least(v_paid, o.total)
  where o.id = v_order_id;
  return null;
end;
$$;
create trigger order_payments_sync after insert or delete on public.order_payments
  for each row execute function public.sync_order_advance();

create or replace function public.verify_order_payment(p_payment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_store uuid;
begin
  select store_id into v_store from public.order_payments where id = p_payment_id;
  if v_store is null or not public.is_store_member(v_store) then
    raise exception 'Pago no encontrado' using errcode = 'P0002';
  end if;
  update public.order_payments set verified_by = (select auth.uid()), verified_at = now()
  where id = p_payment_id and verified_at is null;
end;
$$;
revoke all on function public.verify_order_payment(uuid) from public, anon;
grant execute on function public.verify_order_payment(uuid) to authenticated;

-- Bucket PRIVADO para comprobantes. Ruta: {store_id}/{order_id}/archivo
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('order-receipts', 'order-receipts', false, 5242880,
        array['image/webp', 'image/jpeg', 'image/png', 'application/pdf'])
on conflict (id) do nothing;

create policy "order-receipts: miembros suben"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'order-receipts' and public.is_store_member(public.storage_path_store_id(name)));
create policy "order-receipts: miembros ven"
  on storage.objects for select to authenticated
  using (bucket_id = 'order-receipts' and public.is_store_member(public.storage_path_store_id(name)));
create policy "order-receipts: miembros eliminan"
  on storage.objects for delete to authenticated
  using (bucket_id = 'order-receipts' and public.is_store_member(public.storage_path_store_id(name)));

-- ---------------------------------------------------------------------
-- 6. Adelanto solo en provincia: los pedidos de la landing en Lima no lo llevan
-- ---------------------------------------------------------------------
create or replace function public.orders_lima_no_advance()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.source = 'landing' and new.province_code in ('1501', '0701') and new.advance_amount > 0 then
    new.advance_amount := 0;
    new.balance_due := new.total;
  end if;
  return new;
end;
$$;
create trigger orders_lima_no_advance before insert on public.orders
  for each row execute function public.orders_lima_no_advance();

-- ---------------------------------------------------------------------
-- 7. Máquina de estados por zona (espejo: src/modules/orders/state-machine.ts)
-- ---------------------------------------------------------------------
create or replace function public.order_status_rank(p_status public.order_status, p_zone text)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_zone = 'provincia' then
    return case p_status::text
      when 'new' then 0 when 'pending_confirmation' then 1 when 'confirmed' then 2 when 'preparing' then 3
      when 'shipped' then 4 when 'at_agency' then 5 when 'collected' then 6 when 'delivered' then 7
      else null end;
  end if;
  return case p_status::text
    when 'new' then 0 when 'pending_confirmation' then 1 when 'confirmed' then 2 when 'preparing' then 3
    when 'shipped' then 4 when 'out_for_delivery' then 5 when 'delivered' then 6 when 'collected' then 7
    else null end;
end;
$$;

create or replace function public.order_transition_allowed(p_from public.order_status, p_to public.order_status, p_zone text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  f text := p_from::text;
  t text := p_to::text;
  rf integer := public.order_status_rank(p_from, p_zone);
  rt integer := public.order_status_rank(p_to, p_zone);
begin
  if f = t then return false; end if;
  if rf is not null and rt is not null then return rt > rf; end if;
  if t = 'cancelled' then return f in ('new', 'pending_confirmation', 'confirmed', 'preparing'); end if;
  if t = 'failed_delivery' then return f in ('shipped', 'out_for_delivery', 'at_agency'); end if;
  if t = 'returned' then return f = 'failed_delivery'; end if;
  if f = 'cancelled' then return t in ('new', 'pending_confirmation'); end if;
  return false;
end;
$$;

-- La versión anterior (sin zona) queda como Lima, por compatibilidad
create or replace function public.order_transition_allowed(p_from public.order_status, p_to public.order_status)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select public.order_transition_allowed(p_from, p_to, 'lima');
$$;

-- Descuenta el stock de los productos del pedido. Falla si no alcanza.
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
  for r in
    select oi.product_id, sum(oi.quantity)::integer as qty, max(oi.product_name) as name, max(oi.store_id::text)::uuid as store_id
    from public.order_items oi
    where oi.order_id = p_order_id and oi.product_id is not null
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
      continue; -- producto sin control de stock
    end if;
    if v_left <= 3 then
      insert into public.notifications (store_id, type, title, body, link)
      values (r.store_id, 'low_stock',
              case when v_left = 0 then 'Sin stock: ' else 'Stock bajo: ' end || left(r.name, 150),
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
    where oi.order_id = p_order_id and oi.product_id is not null
    group by oi.product_id
  ) x
  where p.id = x.product_id and p.stock is not null;
end;
$$;
revoke all on function public.release_order_stock(uuid) from public, anon, authenticated;

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

  update public.orders o set
    status = p_to,
    stock_reserved = case when v_reserve then true when v_release then false else o.stock_reserved end,
    courier_id = case when v_rank >= 2 then coalesce(o.courier_id, v_courier.courier_id) else o.courier_id end,
    shipping_cost = case when v_rank >= 2 and o.shipping_cost = 0 then coalesce(v_courier.shipping_cost, 0) else o.shipping_cost end,
    return_shipments = case when p_to::text = 'failed_delivery' then coalesce(o.return_shipments, v_courier.return_shipments, 1) else o.return_shipments end,
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

-- «En curso» incluye «En agencia» y, en provincia, lo cobrado que aún no se recoge
create or replace function public.get_order_stats(p_store_id uuid, p_from timestamptz, p_to timestamptz)
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
      'orders', count(*),
      'orders_value', coalesce(sum(o.total), 0),
      'confirmed', count(*) filter (where o.confirmed_at is not null),
      'shipped', count(*) filter (where o.shipped_at is not null),
      'delivered', count(*) filter (where o.delivered_at is not null),
      'collected', count(*) filter (where o.collected_at is not null),
      'cancelled', count(*) filter (where o.status = 'cancelled'),
      'failed', count(*) filter (where o.status in ('failed_delivery', 'returned')),
      'in_progress', count(*) filter (where o.status::text in ('new', 'pending_confirmation', 'confirmed', 'preparing', 'shipped', 'out_for_delivery', 'at_agency')
                                         or (o.status = 'collected' and o.delivered_at is null)),
      'revenue', coalesce(sum(o.total) filter (where o.delivered_at is not null and o.status not in ('failed_delivery', 'returned')), 0),
      'product_cost', coalesce(sum(o.product_cost_total) filter (where o.delivered_at is not null and o.status not in ('failed_delivery', 'returned')), 0),
      'shipping_cost', coalesce(sum(
        case when o.status in ('failed_delivery', 'returned') then o.shipping_cost * coalesce(o.return_shipments, 1)
             else o.shipping_cost end
      ) filter (where o.shipped_at is not null), 0)
    )
    from public.orders o
    where o.store_id = p_store_id
      and o.created_at >= p_from
      and o.created_at < p_to
  );
end;
$$;

-- ---------------------------------------------------------------------
-- 8. Exportación: reserva atómica (nadie exporta dos veces el mismo pedido)
-- ---------------------------------------------------------------------
create or replace function public.reserve_orders_for_export(
  p_store_id uuid,
  p_courier_id text,
  p_order_ids uuid[],
  p_origin_agency text default null,
  p_mark_shipped boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_courier public.store_couriers;
  v_batch uuid;
  v_ids uuid[];
  v_id uuid;
begin
  if not public.is_store_member(p_store_id) then
    raise exception 'Sin acceso' using errcode = '42501';
  end if;
  if coalesce(array_length(p_order_ids, 1), 0) = 0 then
    raise exception 'Selecciona al menos un pedido' using errcode = 'P0001';
  end if;
  if array_length(p_order_ids, 1) > 500 then
    raise exception 'Máximo 500 pedidos por lote' using errcode = 'P0001';
  end if;
  select * into v_courier from public.store_couriers
  where store_id = p_store_id and courier_id = p_courier_id and enabled;
  if not found then
    raise exception 'Ese courier no está activo en tu tienda' using errcode = 'P0001';
  end if;

  insert into public.export_batches (store_id, courier_id, origin_agency, created_by, marked_shipped)
  values (p_store_id, p_courier_id, nullif(trim(p_origin_agency), ''), (select auth.uid()), p_mark_shipped)
  returning id into v_batch;

  -- Una sola sentencia: si otra persona ya exportó un pedido, aquí no se toma
  with reserved as (
    update public.orders o set
      exported_at = now(),
      export_batch_id = v_batch,
      courier_id = p_courier_id,
      agency_origin = coalesce(nullif(trim(p_origin_agency), ''), o.agency_origin),
      shipping_cost = case when o.shipping_cost = 0 then v_courier.shipping_cost else o.shipping_cost end
    where o.store_id = p_store_id
      and o.id = any (p_order_ids)
      and o.exported_at is null
      and o.status in ('confirmed', 'preparing')
    returning o.id
  )
  select coalesce(array_agg(id), array[]::uuid[]) into v_ids from reserved;

  if coalesce(array_length(v_ids, 1), 0) = 0 then
    raise exception 'Ninguno de esos pedidos está disponible: ya se exportaron o cambiaron de estado' using errcode = 'P0001';
  end if;

  update public.export_batches set order_count = array_length(v_ids, 1) where id = v_batch;

  if p_mark_shipped then
    foreach v_id in array v_ids loop
      perform public.apply_order_status(v_id, 'shipped', 'manual', (select auth.uid()), 'Exportado a ' || p_courier_id);
    end loop;
  end if;

  return jsonb_build_object(
    'batch_id', v_batch,
    'order_ids', to_jsonb(v_ids),
    'skipped', array_length(p_order_ids, 1) - array_length(v_ids, 1)
  );
end;
$$;
revoke all on function public.reserve_orders_for_export(uuid, text, uuid[], text, boolean) from public, anon;
grant execute on function public.reserve_orders_for_export(uuid, text, uuid[], text, boolean) to authenticated;
