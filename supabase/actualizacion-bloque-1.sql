-- Vendia — Actualización Bloque 1: Controlador de pedidos
-- Pegar en Supabase → SQL Editor → New query → Run. Una sola vez.
-- Validado localmente con scripts/validate-sql.ts (PGlite + prueba de humo).

-- =====================================================================
-- Vendia — Bloque 1: Controlador de pedidos
-- Roles (owner = dueño, staff = Confirmador) · notificaciones · secuencia de
-- contacto · motivos · zona Lima/Provincia · pedido manual · equipo.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------
create or replace function public.is_store_owner(p_store_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.store_members m
    where m.store_id = p_store_id and m.user_id = (select auth.uid()) and m.role = 'owner'
  );
$$;
grant execute on function public.is_store_owner(uuid) to authenticated;

create or replace function public.my_store_role(p_store_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select m.role::text from public.store_members m
  where m.store_id = p_store_id and m.user_id = (select auth.uid());
$$;
grant execute on function public.my_store_role(uuid) to authenticated;

-- Solo el dueño escribe catálogo, landings, configuración, gastos y Meta.
-- (El Confirmador puede LEER productos y landings, y trabajar pedidos.)
do $$
declare
  t text;
begin
  foreach t in array array['products', 'product_images', 'product_offers', 'landing_pages'] loop
    execute format('drop policy if exists "%1$s: miembros crean" on public.%1$I', t);
    execute format('drop policy if exists "%1$s: miembros editan" on public.%1$I', t);
    execute format('drop policy if exists "%1$s: miembros eliminan" on public.%1$I', t);
    execute format('create policy "%1$s: dueño crea" on public.%1$I for insert to authenticated with check (public.is_store_owner(store_id))', t);
    execute format('create policy "%1$s: dueño edita" on public.%1$I for update to authenticated using (public.is_store_owner(store_id)) with check (public.is_store_owner(store_id))', t);
    execute format('create policy "%1$s: dueño elimina" on public.%1$I for delete to authenticated using (public.is_store_owner(store_id))', t);
  end loop;
end;
$$;

drop policy if exists "stores: miembros editan nombre" on public.stores;
create policy "stores: dueño edita" on public.stores
  for update to authenticated using (public.is_store_owner(id)) with check (public.is_store_owner(id));

drop policy if exists "store_settings: miembros editan" on public.store_settings;
create policy "store_settings: dueño edita" on public.store_settings
  for update to authenticated using (public.is_store_owner(store_id)) with check (public.is_store_owner(store_id));

drop policy if exists "expenses: miembros leen" on public.expenses;
drop policy if exists "expenses: miembros crean" on public.expenses;
drop policy if exists "expenses: miembros editan" on public.expenses;
drop policy if exists "expenses: miembros eliminan" on public.expenses;
create policy "expenses: dueño lee" on public.expenses for select to authenticated using (public.is_store_owner(store_id));
create policy "expenses: dueño crea" on public.expenses for insert to authenticated with check (public.is_store_owner(store_id));
create policy "expenses: dueño edita" on public.expenses for update to authenticated using (public.is_store_owner(store_id)) with check (public.is_store_owner(store_id));
create policy "expenses: dueño elimina" on public.expenses for delete to authenticated using (public.is_store_owner(store_id));

drop policy if exists "meta_settings: miembros leen" on public.store_meta_settings;
drop policy if exists "meta_settings: miembros crean" on public.store_meta_settings;
drop policy if exists "meta_settings: miembros editan" on public.store_meta_settings;
create policy "meta_settings: dueño lee" on public.store_meta_settings for select to authenticated using (public.is_store_owner(store_id));
create policy "meta_settings: dueño crea" on public.store_meta_settings for insert to authenticated with check (public.is_store_owner(store_id));
create policy "meta_settings: dueño edita" on public.store_meta_settings for update to authenticated using (public.is_store_owner(store_id)) with check (public.is_store_owner(store_id));

drop policy if exists "marketing_events: miembros leen" on public.marketing_events;
create policy "marketing_events: dueño lee" on public.marketing_events for select to authenticated using (public.is_store_owner(store_id));

drop policy if exists "integrations: miembros leen" on public.integrations;
create policy "integrations: dueño lee" on public.integrations for select to authenticated using (public.is_store_owner(store_id));
drop policy if exists "integration_logs: miembros leen" on public.integration_logs;
create policy "integration_logs: dueño lee" on public.integration_logs for select to authenticated using (store_id is not null and public.is_store_owner(store_id));

-- ---------------------------------------------------------------------
-- Pedidos: zona, origen, contacto, motivos, asignación, riesgo
-- ---------------------------------------------------------------------
alter table public.orders
  add column zone text generated always as (
    case when province_code in ('1501', '0701') then 'lima' else 'provincia' end
  ) stored,
  add column source text not null default 'landing' check (source in ('landing', 'manual')),
  add column source_channel text check (source_channel is null or source_channel in ('whatsapp', 'instagram', 'facebook', 'tiktok', 'llamada', 'tienda', 'otro')),
  add column assigned_to uuid references auth.users (id) on delete set null,
  add column contact_attempts integer not null default 0,
  add column last_contact_at timestamptz,
  add column last_contact_result text,
  add column next_contact_at timestamptz,
  add column contact_sequence_done boolean not null default false,
  add column cancel_reason text check (cancel_reason is null or cancel_reason in (
    'no_contesta', 'ya_no_lo_quiere', 'precio', 'pedido_duplicado', 'numero_equivocado',
    'fuera_de_cobertura', 'sin_adelanto', 'pedido_falso', 'otro')),
  add column failure_reason text check (failure_reason is null or failure_reason in (
    'no_estaba', 'rechazo_en_puerta', 'direccion_errada', 'no_pago_saldo', 'no_recogio',
    'cliente_cancelo', 'otro')),
  add column risk_reasons text[] not null default '{}';

create index orders_store_zone_idx on public.orders (store_id, zone, created_at desc);
create index orders_assigned_idx on public.orders (store_id, assigned_to) where assigned_to is not null;
create index orders_next_contact_idx on public.orders (store_id, next_contact_at) where next_contact_at is not null;

grant update (assigned_to) on public.orders to authenticated;

-- Secuencia de contacto configurable por tienda (por defecto: 3 llamadas + WhatsApp)
alter table public.store_settings
  add column contact_sequence text[] not null default array['call', 'call', 'call', 'whatsapp']::text[]
    check (cardinality(contact_sequence) between 1 and 8 and contact_sequence <@ array['call', 'whatsapp']::text[]);
grant update (contact_sequence) on public.store_settings to authenticated;

create table public.order_contact_attempts (
  id bigint generated always as identity primary key,
  store_id uuid not null references public.stores (id) on delete cascade,
  order_id uuid not null,
  attempt_number integer not null,
  channel text not null check (channel in ('call', 'whatsapp')),
  result text not null check (result in ('confirmed', 'no_answer', 'phone_off', 'call_later', 'rejected', 'wrong_number', 'other')),
  note text check (note is null or char_length(note) <= 500),
  next_contact_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (order_id, store_id) references public.orders (id, store_id) on delete cascade
);
create index order_contact_attempts_order_idx on public.order_contact_attempts (order_id, id);

alter table public.order_contact_attempts enable row level security;
revoke all on public.order_contact_attempts from anon, authenticated;
grant select on public.order_contact_attempts to authenticated;
create policy "contact_attempts: miembros leen" on public.order_contact_attempts
  for select to authenticated using (public.is_store_member(store_id));

-- ---------------------------------------------------------------------
-- Notificaciones (por tienda; lectura por usuario)
-- ---------------------------------------------------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  type text not null check (type in (
    'new_order', 'possible_duplicate', 'risky_customer', 'sequence_done', 'callback_due',
    'meta_failed', 'webhook_failed', 'team')),
  title text not null check (char_length(title) <= 200),
  body text check (body is null or char_length(body) <= 500),
  link text check (link is null or char_length(link) <= 300),
  order_id uuid,
  created_at timestamptz not null default now()
);
create index notifications_store_idx on public.notifications (store_id, created_at desc);

create table public.notification_reads (
  notification_id uuid not null references public.notifications (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (notification_id, user_id)
);

alter table public.notifications enable row level security;
alter table public.notification_reads enable row level security;
revoke all on public.notifications, public.notification_reads from anon, authenticated;
grant select on public.notifications to authenticated;
grant select on public.notification_reads to authenticated;
create policy "notifications: miembros leen" on public.notifications
  for select to authenticated using (public.is_store_member(store_id));
create policy "notification_reads: propias" on public.notification_reads
  for select to authenticated using (user_id = (select auth.uid()));

create or replace function public.mark_notifications_read(p_store_id uuid, p_ids uuid[] default null)
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
  insert into public.notification_reads (notification_id, user_id)
  select n.id, (select auth.uid()) from public.notifications n
  where n.store_id = p_store_id and (p_ids is null or n.id = any (p_ids))
  on conflict do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
grant execute on function public.mark_notifications_read(uuid, uuid[]) to authenticated;

create or replace function public.unread_notifications_count(p_store_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case when public.is_store_member(p_store_id) then (
    select count(*)::int from public.notifications n
    where n.store_id = p_store_id
      and n.created_at > now() - interval '30 days'
      and not exists (select 1 from public.notification_reads r where r.notification_id = n.id and r.user_id = (select auth.uid()))
  ) else 0 end;
$$;
grant execute on function public.unread_notifications_count(uuid) to authenticated;

-- Al crear un pedido desde la landing: riesgo del cliente + notificaciones.
create or replace function public.on_order_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bad integer;
  v_reasons text[] := '{}';
  v_money text := 'S/ ' || to_char(new.total, 'FM999990.00');
begin
  select count(*) into v_bad from public.orders o
  where o.store_id = new.store_id and o.customer_id = new.customer_id and o.id <> new.id
    and (o.status in ('failed_delivery', 'returned') or (o.status = 'cancelled' and o.confirmed_at is not null));
  if v_bad > 0 then
    v_reasons := array_append(v_reasons, 'historial_rechazos');
  end if;
  if new.is_possible_duplicate then
    v_reasons := array_append(v_reasons, 'posible_duplicado');
  end if;
  if cardinality(v_reasons) > 0 then
    update public.orders set risk_reasons = v_reasons where id = new.id;
  end if;

  if new.source = 'landing' then
    insert into public.notifications (store_id, type, title, body, link, order_id)
    values (new.store_id, 'new_order', 'Nuevo pedido #' || new.order_number,
            new.customer_name || ' · ' || v_money || ' · ' || new.district_name || ' (' || initcap(new.zone) || ')',
            '/dashboard/pedidos/' || new.id, new.id);
    if v_bad > 0 then
      insert into public.notifications (store_id, type, title, body, link, order_id)
      values (new.store_id, 'risky_customer', 'Cliente con rechazos previos · #' || new.order_number,
              new.customer_name || ' tiene ' || v_bad || ' pedido(s) no entregado(s) o cancelado(s) después de confirmar.',
              '/dashboard/pedidos/' || new.id, new.id);
    end if;
    if new.is_possible_duplicate then
      insert into public.notifications (store_id, type, title, body, link, order_id)
      values (new.store_id, 'possible_duplicate', 'Posible pedido duplicado · #' || new.order_number,
              'El mismo celular pidió este producto hace menos de 30 minutos.', '/dashboard/pedidos/' || new.id, new.id);
    end if;
  end if;
  return new;
end;
$$;

create trigger orders_after_insert
  after insert on public.orders
  for each row execute function public.on_order_created();

-- Tiempo real (Supabase Realtime) para notificaciones y pedidos
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications') then
      execute 'alter publication supabase_realtime add table public.notifications';
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'orders') then
      execute 'alter publication supabase_realtime add table public.orders';
    end if;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Cambio de estado con motivo (reemplaza la versión anterior)
-- ---------------------------------------------------------------------
drop function if exists public.change_order_status(uuid, public.order_status, text);

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
grant execute on function public.change_order_status(uuid, public.order_status, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- Registrar un intento de contacto
-- ---------------------------------------------------------------------
create or replace function public.log_contact_attempt(
  p_order_id uuid,
  p_channel text,
  p_result text,
  p_note text default null,
  p_next_contact_at timestamptz default null,
  p_cancel_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_seq text[];
  v_attempt integer;
  v_done boolean := false;
  v_uid uuid := (select auth.uid());
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or not public.is_store_member(v_order.store_id) then
    raise exception 'Pedido no encontrado' using errcode = 'P0002';
  end if;
  if v_order.status not in ('new', 'pending_confirmation') then
    raise exception 'Este pedido ya no está por confirmar' using errcode = 'P0001';
  end if;
  if p_channel not in ('call', 'whatsapp') then
    raise exception 'Canal inválido' using errcode = 'P0001';
  end if;
  if p_result = 'call_later' and (p_next_contact_at is null or p_next_contact_at < now() - interval '5 minutes') then
    raise exception 'Indica cuándo volver a llamar' using errcode = 'P0001';
  end if;

  select coalesce(s.contact_sequence, array['call', 'call', 'call', 'whatsapp']::text[]) into v_seq
  from public.store_settings s where s.store_id = v_order.store_id;
  v_attempt := v_order.contact_attempts + 1;

  insert into public.order_contact_attempts (store_id, order_id, attempt_number, channel, result, note, next_contact_at, created_by)
  values (v_order.store_id, v_order.id, v_attempt, p_channel, p_result, nullif(trim(p_note), ''),
          case when p_result = 'call_later' then p_next_contact_at end, v_uid);

  update public.orders set
    contact_attempts = v_attempt,
    last_contact_at = now(),
    last_contact_result = p_result,
    next_contact_at = case when p_result = 'call_later' then p_next_contact_at else null end,
    assigned_to = coalesce(assigned_to, v_uid)
  where id = v_order.id;

  if p_result = 'confirmed' then
    perform public.apply_order_status(v_order.id, 'confirmed', 'manual', v_uid,
      'Confirmado por ' || case p_channel when 'call' then 'llamada' else 'WhatsApp' end);
  elsif p_result = 'rejected' then
    perform public.apply_order_status(v_order.id, 'cancelled', 'manual', v_uid, nullif(trim(p_note), ''));
    update public.orders set cancel_reason = coalesce(p_cancel_reason, 'ya_no_lo_quiere') where id = v_order.id;
  else
    if v_order.status = 'new' then
      perform public.apply_order_status(v_order.id, 'pending_confirmation', 'manual', v_uid, null);
    end if;
    if p_result <> 'call_later' and v_attempt >= cardinality(v_seq) and not v_order.contact_sequence_done then
      v_done := true;
      update public.orders set contact_sequence_done = true where id = v_order.id;
      insert into public.notifications (store_id, type, title, body, link, order_id)
      values (v_order.store_id, 'sequence_done', 'Secuencia completa sin respuesta · #' || v_order.order_number,
              v_order.customer_name || ': ' || v_attempt || ' intentos sin confirmar. Revisa si lo cancelas.',
              '/dashboard/pedidos/' || v_order.id, v_order.id);
    end if;
  end if;

  return jsonb_build_object(
    'attempt', v_attempt,
    'sequence_length', cardinality(v_seq),
    'sequence_done', v_done or v_order.contact_sequence_done,
    'next_channel', case when v_attempt < cardinality(v_seq) then v_seq[v_attempt + 1] end,
    'status', (select status from public.orders where id = v_order.id)
  );
end;
$$;
grant execute on function public.log_contact_attempt(uuid, text, text, text, timestamptz, text) to authenticated;

-- ---------------------------------------------------------------------
-- Asignación de pedidos
-- ---------------------------------------------------------------------
create or replace function public.assign_orders(p_order_ids uuid[], p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_store uuid;
  v_count integer;
begin
  select distinct store_id into v_store from public.orders where id = any (p_order_ids) limit 1;
  if v_store is null or not public.is_store_member(v_store) then
    raise exception 'Sin acceso' using errcode = '42501';
  end if;
  if p_user_id is not null and not exists (select 1 from public.store_members where store_id = v_store and user_id = p_user_id) then
    raise exception 'Esa persona no es parte del equipo' using errcode = 'P0001';
  end if;
  update public.orders set assigned_to = p_user_id where id = any (p_order_ids) and store_id = v_store;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
grant execute on function public.assign_orders(uuid[], uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Pedido manual (WhatsApp, Instagram, llamada…)
-- ---------------------------------------------------------------------
create or replace function public.create_manual_order(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_store_id uuid := (p ->> 'store_id')::uuid;
  v_uid uuid := (select auth.uid());
  v_settings public.store_settings;
  v_product public.products;
  v_offer public.product_offers;
  v_district public.ubigeo_districts;
  v_province public.ubigeo_provinces;
  v_department public.ubigeo_departments;
  v_customer_id uuid;
  v_order public.orders;
  v_order_number integer;
  v_quantity integer;
  v_subtotal numeric(12, 2);
  v_shipping numeric(12, 2);
  v_total numeric(12, 2);
  v_advance numeric(12, 2);
  v_phone text := p ->> 'phone';
  v_first text := trim(p ->> 'first_name');
  v_last text := nullif(trim(coalesce(p ->> 'last_name', '')), '');
  v_idem text := nullif(p ->> 'idempotency_key', '');
begin
  if v_store_id is null or not public.is_store_member(v_store_id) then
    raise exception 'Sin acceso' using errcode = '42501';
  end if;
  if v_idem is not null then
    select * into v_order from public.orders where store_id = v_store_id and idempotency_key = v_idem;
    if found then
      return jsonb_build_object('order_id', v_order.id, 'order_number', v_order.order_number, 'duplicate_submit', true);
    end if;
  end if;

  select * into v_settings from public.store_settings where store_id = v_store_id;
  select * into v_product from public.products where id = (p ->> 'product_id')::uuid and store_id = v_store_id and status <> 'archived';
  if not found then
    raise exception 'Producto no válido' using errcode = 'P0001';
  end if;
  if nullif(p ->> 'offer_id', '') is not null then
    select * into v_offer from public.product_offers where id = (p ->> 'offer_id')::uuid and product_id = v_product.id;
    if not found then
      raise exception 'Oferta no válida' using errcode = 'P0001';
    end if;
    v_quantity := v_offer.quantity;
    v_subtotal := v_offer.price;
  else
    v_quantity := greatest(coalesce((p ->> 'quantity')::integer, 1), 1);
    v_subtotal := v_product.price * v_quantity;
  end if;
  -- Precio acordado por chat (opcional): lo decide el equipo
  if nullif(p ->> 'subtotal', '') is not null then
    v_subtotal := (p ->> 'subtotal')::numeric;
    if v_subtotal < 0 then
      raise exception 'Precio inválido' using errcode = 'P0001';
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

  v_shipping := coalesce(nullif(p ->> 'shipping', '')::numeric,
    case when v_province.code in ('1501', '0701') then v_settings.shipping_lima else v_settings.shipping_province end);
  v_total := v_subtotal + v_shipping;
  v_advance := least(coalesce(nullif(p ->> 'advance', '')::numeric, 0), v_total);

  insert into public.customers as c (store_id, first_name, last_name, phone, dni, address, reference, district_code)
  values (v_store_id, v_first, v_last, v_phone, nullif(p ->> 'dni', ''), trim(p ->> 'address'),
          nullif(trim(coalesce(p ->> 'reference', '')), ''), v_district.code)
  on conflict (store_id, phone) do update set
    first_name = excluded.first_name,
    last_name = coalesce(excluded.last_name, c.last_name),
    dni = coalesce(excluded.dni, c.dni),
    address = excluded.address,
    reference = excluded.reference,
    district_code = excluded.district_code
  returning id into v_customer_id;

  update public.stores set next_order_number = next_order_number + 1
  where id = v_store_id returning next_order_number - 1 into v_order_number;

  insert into public.orders (
    store_id, order_number, customer_id, status, source, source_channel, assigned_to,
    subtotal, shipping_charged, total, advance_amount, balance_due, product_cost_total,
    customer_name, customer_phone, department_code, department_name, province_code, province_name,
    district_code, district_name, address, reference, dni, customer_notes, internal_notes, idempotency_key
  ) values (
    v_store_id, v_order_number, v_customer_id, 'new', 'manual', nullif(p ->> 'source_channel', ''), v_uid,
    v_subtotal, v_shipping, v_total, v_advance, v_total - v_advance, v_product.cost * v_quantity,
    trim(v_first || ' ' || coalesce(v_last, '')), v_phone, v_department.code, v_department.name, v_province.code, v_province.name,
    v_district.code, v_district.name, trim(p ->> 'address'), nullif(trim(coalesce(p ->> 'reference', '')), ''),
    nullif(p ->> 'dni', ''), nullif(trim(coalesce(p ->> 'notes', '')), ''), nullif(trim(coalesce(p ->> 'internal_notes', '')), ''), v_idem
  ) returning * into v_order;

  insert into public.order_items (store_id, order_id, product_id, offer_id, product_name, offer_name, quantity, line_price, unit_cost)
  values (v_store_id, v_order.id, v_product.id, v_offer.id, v_product.name, v_offer.name, v_quantity, v_subtotal, v_product.cost);

  insert into public.order_status_history (store_id, order_id, from_status, to_status, source, changed_by, note)
  values (v_store_id, v_order.id, null, 'new', 'manual', v_uid,
          'Pedido manual' || coalesce(' · ' || (p ->> 'source_channel'), ''));

  if coalesce((p ->> 'already_confirmed')::boolean, false) then
    perform public.apply_order_status(v_order.id, 'confirmed', 'manual', v_uid, 'Confirmado al registrar');
  end if;

  return jsonb_build_object('order_id', v_order.id, 'order_number', v_order.order_number, 'duplicate_submit', false);
end;
$$;
grant execute on function public.create_manual_order(jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- Equipo: invitaciones por enlace
-- ---------------------------------------------------------------------
create table public.store_invitations (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  email text not null check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  role public.member_role not null default 'staff',
  token text not null unique check (char_length(token) >= 24),
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id) on delete set null
);
create index store_invitations_store_idx on public.store_invitations (store_id, created_at desc);

alter table public.store_invitations enable row level security;
revoke all on public.store_invitations from anon, authenticated;
grant select (id, store_id, email, role, created_at, expires_at, accepted_at) on public.store_invitations to authenticated;
create policy "store_invitations: dueño lee" on public.store_invitations
  for select to authenticated using (public.is_store_owner(store_id));

create or replace function public.create_store_invitation(p_store_id uuid, p_email text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
begin
  if not public.is_store_owner(p_store_id) then
    raise exception 'Solo el dueño puede invitar' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.store_members m join auth.users u on u.id = m.user_id
    where m.store_id = p_store_id and lower(u.email) = lower(trim(p_email))
  ) then
    raise exception 'Esa persona ya es parte del equipo' using errcode = 'P0001';
  end if;
  insert into public.store_invitations (store_id, email, role, token, invited_by)
  values (p_store_id, lower(trim(p_email)), 'staff', v_token, (select auth.uid()));
  return v_token;
end;
$$;
grant execute on function public.create_store_invitation(uuid, text) to authenticated;

create or replace function public.get_invitation(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'store_name', s.name,
    'email', i.email,
    'expired', i.expires_at < now(),
    'accepted', i.accepted_at is not null
  )
  from public.store_invitations i join public.stores s on s.id = i.store_id
  where i.token = p_token;
$$;
grant execute on function public.get_invitation(text) to anon, authenticated;

create or replace function public.accept_store_invitation(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.store_invitations;
  v_uid uuid := (select auth.uid());
  v_email text;
begin
  if v_uid is null then
    raise exception 'Inicia sesión para aceptar la invitación' using errcode = '42501';
  end if;
  select * into v_inv from public.store_invitations where token = p_token for update;
  if not found then
    raise exception 'Invitación no válida' using errcode = 'P0002';
  end if;
  if v_inv.accepted_at is not null then
    raise exception 'Esta invitación ya fue usada' using errcode = 'P0001';
  end if;
  if v_inv.expires_at < now() then
    raise exception 'La invitación venció. Pide una nueva.' using errcode = 'P0001';
  end if;
  select lower(email) into v_email from auth.users where id = v_uid;
  if v_email is distinct from v_inv.email then
    raise exception 'Esta invitación es para %. Ingresa con ese correo.', v_inv.email using errcode = 'P0001';
  end if;
  insert into public.store_members (store_id, user_id, role) values (v_inv.store_id, v_uid, v_inv.role)
  on conflict (store_id, user_id) do nothing;
  update public.store_invitations set accepted_at = now(), accepted_by = v_uid where id = v_inv.id;
  insert into public.notifications (store_id, type, title, body, link)
  values (v_inv.store_id, 'team', 'Nuevo miembro del equipo', v_inv.email || ' aceptó la invitación.', '/dashboard/equipo');
  return v_inv.store_id;
end;
$$;
grant execute on function public.accept_store_invitation(text) to authenticated;

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
      'joined_at', m.created_at
    ) order by (m.role = 'owner') desc, m.created_at)
    from public.store_members m
    join auth.users u on u.id = m.user_id
    left join public.profiles pr on pr.id = m.user_id
    where m.store_id = p_store_id
  ), '[]'::jsonb) else '[]'::jsonb end;
$$;
grant execute on function public.get_store_team(uuid) to authenticated;

create or replace function public.remove_store_member(p_store_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_store_owner(p_store_id) then
    raise exception 'Solo el dueño puede quitar miembros' using errcode = '42501';
  end if;
  if exists (select 1 from public.store_members where store_id = p_store_id and user_id = p_user_id and role = 'owner') then
    raise exception 'No se puede quitar al dueño' using errcode = 'P0001';
  end if;
  update public.orders set assigned_to = null where store_id = p_store_id and assigned_to = p_user_id;
  delete from public.store_members where store_id = p_store_id and user_id = p_user_id;
end;
$$;
grant execute on function public.remove_store_member(uuid, uuid) to authenticated;

create or replace function public.revoke_store_invitation(p_invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_store uuid;
begin
  select store_id into v_store from public.store_invitations where id = p_invitation_id;
  if v_store is null or not public.is_store_owner(v_store) then
    raise exception 'Sin acceso' using errcode = '42501';
  end if;
  delete from public.store_invitations where id = p_invitation_id and accepted_at is null;
end;
$$;
grant execute on function public.revoke_store_invitation(uuid) to authenticated;

-- Funciones internas: nunca expuestas
revoke all on function public.on_order_created() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Finanzas solo para el dueño (gasto publicitario): mismas funciones, permiso de dueño
-- ---------------------------------------------------------------------

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
  if not public.is_store_owner(p_store_id) then
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

-- Publicar / despublicar landings: solo el dueño

create or replace function public.publish_landing_page(p_landing_id uuid)
returns public.landing_pages
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_landing public.landing_pages;
begin
  select * into v_landing from public.landing_pages where id = p_landing_id for update;
  if not found or not public.is_store_owner(v_landing.store_id) then
    raise exception 'Landing no encontrada' using errcode = 'P0002';
  end if;

  if not exists (
    select 1 from public.products p
    where p.id = v_landing.product_id and p.status = 'active'
  ) then
    raise exception 'El producto debe estar activo para publicar' using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from public.product_offers o
    where o.product_id = v_landing.product_id and o.is_active
  ) then
    raise exception 'El producto necesita al menos una oferta activa' using errcode = 'P0001';
  end if;

  update public.landing_pages set
    published_content = content,
    status = 'published',
    published_at = now()
  where id = p_landing_id
  returning * into v_landing;

  return v_landing;
end;
$$;
grant execute on function public.publish_landing_page(uuid) to authenticated;

create or replace function public.unpublish_landing_page(p_landing_id uuid)
returns public.landing_pages
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_landing public.landing_pages;
begin
  select * into v_landing from public.landing_pages where id = p_landing_id for update;
  if not found or not public.is_store_owner(v_landing.store_id) then
    raise exception 'Landing no encontrada' using errcode = 'P0002';
  end if;
  update public.landing_pages set status = 'draft' where id = p_landing_id returning * into v_landing;
  return v_landing;
end;
$$;
grant execute on function public.unpublish_landing_page(uuid) to authenticated;

-- Cambio de estado en lote, ahora con motivo (cancelación / no entrega)
drop function if exists public.change_orders_status(uuid[], public.order_status, text);

create or replace function public.change_orders_status(
  p_order_ids uuid[],
  p_to public.order_status,
  p_note text default null,
  p_reason text default null
)
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
      perform public.change_order_status(v_id, p_to, p_note, p_reason);
      v_ok := v_ok + 1;
    exception when others then
      v_failed := v_failed + 1;
    end;
  end loop;
  return jsonb_build_object('updated', v_ok, 'failed', v_failed);
end;
$$;
grant execute on function public.change_orders_status(uuid[], public.order_status, text, text) to authenticated;
