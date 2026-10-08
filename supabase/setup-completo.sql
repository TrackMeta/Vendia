-- =====================================================================
-- Vendia — instalación completa de la base de datos (Fase 1)
-- Generado a partir de supabase/migrations/*.sql — pegar en Supabase → SQL Editor → Run
-- Ejecutar UNA sola vez sobre un proyecto vacío.
-- =====================================================================

-- >>> supabase/migrations/20261008000100_core_schema.sql
-- =====================================================================
-- Vendia — Fase 1: esquema base
-- Multi-tenant por store_id + RLS en todas las tablas.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------
create type public.store_status as enum ('active', 'blocked');
create type public.member_role as enum ('owner', 'staff');
create type public.product_status as enum ('draft', 'active', 'archived');
create type public.landing_status as enum ('draft', 'published');
create type public.order_status as enum (
  'new',
  'pending_confirmation',
  'confirmed',
  'preparing',
  'shipped',
  'out_for_delivery',
  'delivered',
  'collected',
  'cancelled',
  'failed_delivery',
  'returned'
);
create type public.status_change_source as enum ('manual', 'system', 'integration');

-- ---------------------------------------------------------------------
-- Utilidades
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Usuarios y tiendas
-- ---------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.stores (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete restrict,
  name text not null check (char_length(name) between 2 and 80),
  slug text not null unique
    check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) between 3 and 40),
  country char(2) not null default 'PE',
  currency char(3) not null default 'PEN',
  status public.store_status not null default 'active',
  next_order_number integer not null default 1001,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index stores_owner_id_idx on public.stores (owner_id);

create table public.store_members (
  store_id uuid not null references public.stores (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.member_role not null default 'staff',
  created_at timestamptz not null default now(),
  primary key (store_id, user_id)
);
create index store_members_user_id_idx on public.store_members (user_id);

create table public.store_settings (
  store_id uuid primary key references public.stores (id) on delete cascade,
  logo_path text,
  favicon_path text,
  whatsapp text,
  phone text,
  email text,
  address text,
  -- COD
  shipping_lima numeric(12, 2) not null default 0 check (shipping_lima >= 0),
  shipping_province numeric(12, 2) not null default 0 check (shipping_province >= 0),
  advance_amount numeric(12, 2) not null default 0 check (advance_amount >= 0),
  payment_methods text[] not null default array['Contraentrega']::text[],
  confirmation_message text not null default '¡Gracias por tu pedido! Te escribiremos por WhatsApp para confirmarlo.',
  -- Estado que cuenta como venta real y dispara Purchase en Meta (Fase 2)
  purchase_trigger_status public.order_status not null default 'delivered'
    check (purchase_trigger_status in ('confirmed', 'shipped', 'delivered', 'collected')),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Funciones de acceso (usadas por RLS)
-- ---------------------------------------------------------------------
create or replace function public.is_store_member(p_store_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.store_members m
    where m.store_id = p_store_id
      and m.user_id = (select auth.uid())
  );
$$;

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.platform_admins a where a.user_id = (select auth.uid())
  );
$$;

-- ---------------------------------------------------------------------
-- Ubigeo (INEI)
-- ---------------------------------------------------------------------
create table public.ubigeo_departments (
  code char(2) primary key check (code ~ '^[0-9]{2}$'),
  name text not null
);

create table public.ubigeo_provinces (
  code char(4) primary key check (code ~ '^[0-9]{4}$'),
  department_code char(2) not null references public.ubigeo_departments (code),
  name text not null,
  check (left(code, 2) = department_code)
);
create index ubigeo_provinces_department_idx on public.ubigeo_provinces (department_code);

create table public.ubigeo_districts (
  code char(6) primary key check (code ~ '^[0-9]{6}$'),
  province_code char(4) not null references public.ubigeo_provinces (code),
  name text not null,
  reniec_code char(6),
  is_provisional boolean not null default false,
  check (left(code, 4) = province_code)
);
create index ubigeo_districts_province_idx on public.ubigeo_districts (province_code);

-- ---------------------------------------------------------------------
-- Catálogo
-- ---------------------------------------------------------------------
create table public.products (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 160),
  sku text check (sku is null or char_length(sku) between 1 and 64),
  description text,
  price numeric(12, 2) not null check (price >= 0),
  compare_at_price numeric(12, 2) check (compare_at_price is null or compare_at_price >= 0),
  cost numeric(12, 2) not null default 0 check (cost >= 0),
  stock integer check (stock is null or stock >= 0),
  category text,
  status public.product_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, sku),
  unique (id, store_id)
);
create index products_store_idx on public.products (store_id, created_at desc);

create table public.product_images (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  product_id uuid not null,
  storage_path text not null,
  width integer,
  height integer,
  position integer not null default 0,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  foreign key (product_id, store_id) references public.products (id, store_id) on delete cascade
);
create index product_images_product_idx on public.product_images (product_id, position);
create unique index product_images_one_primary on public.product_images (product_id) where is_primary;

create table public.product_offers (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  product_id uuid not null,
  name text not null check (char_length(name) between 1 and 80),
  quantity integer not null check (quantity between 1 and 100),
  price numeric(12, 2) not null check (price >= 0),
  compare_at_price numeric(12, 2) check (compare_at_price is null or compare_at_price >= 0),
  badge text check (badge is null or char_length(badge) <= 40),
  image_path text,
  position integer not null default 0,
  is_default boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (product_id, store_id) references public.products (id, store_id) on delete cascade,
  unique (id, store_id)
);
create index product_offers_product_idx on public.product_offers (product_id, position);

-- ---------------------------------------------------------------------
-- Landing pages
-- ---------------------------------------------------------------------
create table public.landing_pages (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  product_id uuid not null,
  slug text not null
    check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) between 2 and 80),
  title text not null check (char_length(title) between 1 and 160),
  content jsonb not null default '{}'::jsonb,
  published_content jsonb,
  settings jsonb not null default '{}'::jsonb,
  status public.landing_status not null default 'draft',
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (product_id, store_id) references public.products (id, store_id),
  unique (store_id, slug),
  unique (id, store_id),
  check (status = 'draft' or published_content is not null)
);
create index landing_pages_store_idx on public.landing_pages (store_id, updated_at desc);

-- ---------------------------------------------------------------------
-- Clientes y pedidos
-- ---------------------------------------------------------------------
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  first_name text not null,
  last_name text,
  phone text not null check (phone ~ '^51[0-9]{9}$'),
  whatsapp text,
  dni text check (dni is null or dni ~ '^[0-9]{8}$'),
  address text,
  reference text,
  district_code char(6) references public.ubigeo_districts (code),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, phone),
  unique (id, store_id)
);
create index customers_store_idx on public.customers (store_id, created_at desc);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  order_number integer not null,
  customer_id uuid not null,
  landing_page_id uuid,
  status public.order_status not null default 'new',

  -- Montos (lo que paga el cliente)
  subtotal numeric(12, 2) not null check (subtotal >= 0),
  shipping_charged numeric(12, 2) not null default 0 check (shipping_charged >= 0),
  total numeric(12, 2) not null check (total >= 0),
  advance_amount numeric(12, 2) not null default 0 check (advance_amount >= 0),
  balance_due numeric(12, 2) not null check (balance_due >= 0),

  -- Costos (snapshot / editables por el vendedor)
  product_cost_total numeric(12, 2) not null default 0 check (product_cost_total >= 0),
  shipping_cost numeric(12, 2) not null default 0 check (shipping_cost >= 0),

  -- Cliente y ubicación (snapshot)
  customer_name text not null,
  customer_phone text not null,
  department_code char(2) not null,
  department_name text not null,
  province_code char(4) not null,
  province_name text not null,
  district_code char(6) not null references public.ubigeo_districts (code),
  district_name text not null,
  address text not null,
  reference text,
  dni text,
  delivery_method text,
  customer_notes text,
  internal_notes text,

  -- Control
  idempotency_key text,
  is_possible_duplicate boolean not null default false,

  -- Hitos
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  confirmed_at timestamptz,
  shipped_at timestamptz,
  delivered_at timestamptz,
  collected_at timestamptz,
  cancelled_at timestamptz,
  failed_at timestamptz,
  returned_at timestamptz,

  foreign key (customer_id, store_id) references public.customers (id, store_id),
  foreign key (landing_page_id, store_id) references public.landing_pages (id, store_id) on delete set null (landing_page_id),
  unique (store_id, order_number),
  unique (store_id, idempotency_key),
  unique (id, store_id),
  check (total = subtotal + shipping_charged),
  check (balance_due = total - advance_amount)
);
create index orders_store_created_idx on public.orders (store_id, created_at desc);
create index orders_store_status_idx on public.orders (store_id, status);
create index orders_customer_idx on public.orders (customer_id);
create index orders_district_idx on public.orders (store_id, district_code);
create index orders_landing_idx on public.orders (landing_page_id);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  order_id uuid not null,
  product_id uuid,
  offer_id uuid,
  product_name text not null,
  offer_name text,
  quantity integer not null check (quantity > 0),
  line_price numeric(12, 2) not null check (line_price >= 0),
  unit_cost numeric(12, 2) not null default 0 check (unit_cost >= 0),
  created_at timestamptz not null default now(),
  foreign key (order_id, store_id) references public.orders (id, store_id) on delete cascade
);
create index order_items_order_idx on public.order_items (order_id);
create index order_items_product_idx on public.order_items (store_id, product_id);

create table public.order_status_history (
  id bigint generated always as identity primary key,
  store_id uuid not null references public.stores (id) on delete cascade,
  order_id uuid not null,
  from_status public.order_status,
  to_status public.order_status not null,
  source public.status_change_source not null default 'manual',
  changed_by uuid references auth.users (id) on delete set null,
  note text,
  created_at timestamptz not null default now(),
  foreign key (order_id, store_id) references public.orders (id, store_id) on delete cascade
);
create index order_status_history_order_idx on public.order_status_history (order_id, created_at);

create table public.order_attribution (
  order_id uuid primary key,
  store_id uuid not null references public.stores (id) on delete cascade,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  fbclid text,
  fbc text,
  fbp text,
  campaign_id text,
  adset_id text,
  ad_id text,
  landing_page_id uuid,
  referrer text,
  landing_url text,
  client_ip inet,
  user_agent text,
  created_at timestamptz not null default now(),
  foreign key (order_id, store_id) references public.orders (id, store_id) on delete cascade
);
create index order_attribution_campaign_idx on public.order_attribution (store_id, campaign_id);
create index order_attribution_utm_campaign_idx on public.order_attribution (store_id, utm_campaign);
create index order_attribution_ip_idx on public.order_attribution (client_ip, created_at);

-- ---------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger stores_updated_at before update on public.stores
  for each row execute function public.set_updated_at();
create trigger store_settings_updated_at before update on public.store_settings
  for each row execute function public.set_updated_at();
create trigger products_updated_at before update on public.products
  for each row execute function public.set_updated_at();
create trigger product_offers_updated_at before update on public.product_offers
  for each row execute function public.set_updated_at();
create trigger landing_pages_updated_at before update on public.landing_pages
  for each row execute function public.set_updated_at();
create trigger customers_updated_at before update on public.customers
  for each row execute function public.set_updated_at();
create trigger orders_updated_at before update on public.orders
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Perfil automático al registrarse
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, nullif(new.raw_user_meta_data ->> 'full_name', ''));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- >>> supabase/migrations/20261008000200_rls.sql
-- =====================================================================
-- Vendia — Row Level Security
-- Regla: un usuario solo accede a filas de tiendas donde es miembro.
-- Los visitantes anónimos NO leen ni escriben tablas directamente:
-- usan funciones con permisos acotados (landing pública, crear pedido).
-- =====================================================================

alter table public.profiles enable row level security;
alter table public.platform_admins enable row level security;
alter table public.stores enable row level security;
alter table public.store_members enable row level security;
alter table public.store_settings enable row level security;
alter table public.ubigeo_departments enable row level security;
alter table public.ubigeo_provinces enable row level security;
alter table public.ubigeo_districts enable row level security;
alter table public.products enable row level security;
alter table public.product_images enable row level security;
alter table public.product_offers enable row level security;
alter table public.landing_pages enable row level security;
alter table public.customers enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_status_history enable row level security;
alter table public.order_attribution enable row level security;

-- Por defecto, nadie (anon/authenticated) tiene privilegios; se otorgan explícitamente.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated, public;

-- ---------------------------------------------------------------------
-- Perfiles
-- ---------------------------------------------------------------------
grant select, update (full_name) on public.profiles to authenticated;
create policy "profiles: ver el propio" on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy "profiles: editar el propio" on public.profiles
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- platform_admins: sin acceso desde el cliente (solo service role).

-- ---------------------------------------------------------------------
-- Tiendas
-- ---------------------------------------------------------------------
grant select, update (name) on public.stores to authenticated;
create policy "stores: miembros ven su tienda" on public.stores
  for select to authenticated using (public.is_store_member(id));
create policy "stores: miembros editan nombre" on public.stores
  for update to authenticated using (public.is_store_member(id)) with check (public.is_store_member(id));

grant select on public.store_members to authenticated;
create policy "store_members: ver miembros de mi tienda" on public.store_members
  for select to authenticated using (public.is_store_member(store_id));

grant select, update (
  logo_path, favicon_path, whatsapp, phone, email, address,
  shipping_lima, shipping_province, advance_amount, payment_methods,
  confirmation_message, purchase_trigger_status
) on public.store_settings to authenticated;
create policy "store_settings: miembros" on public.store_settings
  for select to authenticated using (public.is_store_member(store_id));
create policy "store_settings: miembros editan" on public.store_settings
  for update to authenticated using (public.is_store_member(store_id)) with check (public.is_store_member(store_id));

-- ---------------------------------------------------------------------
-- Ubigeo: lectura pública
-- ---------------------------------------------------------------------
grant select on public.ubigeo_departments, public.ubigeo_provinces, public.ubigeo_districts to anon, authenticated;
create policy "ubigeo_departments: lectura" on public.ubigeo_departments for select to anon, authenticated using (true);
create policy "ubigeo_provinces: lectura" on public.ubigeo_provinces for select to anon, authenticated using (true);
create policy "ubigeo_districts: lectura" on public.ubigeo_districts for select to anon, authenticated using (true);

-- ---------------------------------------------------------------------
-- Catálogo y landings: CRUD para miembros de la tienda
-- ---------------------------------------------------------------------
grant select, insert, update, delete on public.products, public.product_images, public.product_offers to authenticated;
grant select, insert, delete on public.landing_pages to authenticated;
-- published_content / status / published_at solo cambian vía publish_landing_page()
grant update (product_id, slug, title, content, settings) on public.landing_pages to authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['products', 'product_images', 'product_offers', 'landing_pages'] loop
    execute format(
      'create policy "%1$s: miembros leen" on public.%1$I for select to authenticated using (public.is_store_member(store_id))', t);
    execute format(
      'create policy "%1$s: miembros crean" on public.%1$I for insert to authenticated with check (public.is_store_member(store_id))', t);
    execute format(
      'create policy "%1$s: miembros editan" on public.%1$I for update to authenticated using (public.is_store_member(store_id)) with check (public.is_store_member(store_id))', t);
    execute format(
      'create policy "%1$s: miembros eliminan" on public.%1$I for delete to authenticated using (public.is_store_member(store_id))', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------
-- Clientes y pedidos
-- Los pedidos se crean SOLO con create_cod_order() (servidor).
-- Los estados cambian SOLO con change_order_status().
-- ---------------------------------------------------------------------
grant select, update (first_name, last_name, whatsapp, dni, address, reference) on public.customers to authenticated;
create policy "customers: miembros leen" on public.customers
  for select to authenticated using (public.is_store_member(store_id));
create policy "customers: miembros editan" on public.customers
  for update to authenticated using (public.is_store_member(store_id)) with check (public.is_store_member(store_id));

grant select, update (shipping_cost, internal_notes, address, reference, delivery_method) on public.orders to authenticated;
create policy "orders: miembros leen" on public.orders
  for select to authenticated using (public.is_store_member(store_id));
create policy "orders: miembros editan campos permitidos" on public.orders
  for update to authenticated using (public.is_store_member(store_id)) with check (public.is_store_member(store_id));

grant select on public.order_items, public.order_status_history, public.order_attribution to authenticated;
create policy "order_items: miembros leen" on public.order_items
  for select to authenticated using (public.is_store_member(store_id));
create policy "order_status_history: miembros leen" on public.order_status_history
  for select to authenticated using (public.is_store_member(store_id));
create policy "order_attribution: miembros leen" on public.order_attribution
  for select to authenticated using (public.is_store_member(store_id));

-- >>> supabase/migrations/20261008000300_functions.sql
-- =====================================================================
-- Vendia — Funciones de negocio
-- =====================================================================

-- Las políticas RLS se evalúan con el rol del usuario: necesita EXECUTE.
grant execute on function public.is_store_member(uuid) to authenticated;
grant execute on function public.is_platform_admin() to authenticated;

-- ---------------------------------------------------------------------
-- Crear tienda (onboarding). 1 usuario = 1 tienda por ahora.
-- ---------------------------------------------------------------------
create or replace function public.create_store(p_name text, p_slug text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_store_id uuid;
  v_reserved text[] := array[
    'admin', 'api', 'app', 'auth', 'dashboard', 'login', 'logout', 'registro', 'p',
    'soporte', 'ayuda', 'vendia', 'www', 'static', 'settings', 'configuracion'
  ];
begin
  if v_user is null then
    raise exception 'No autenticado' using errcode = '42501';
  end if;
  if exists (select 1 from public.stores s where s.owner_id = v_user) then
    raise exception 'Ya tienes una tienda' using errcode = 'P0001';
  end if;
  if lower(p_slug) = any (v_reserved) then
    raise exception 'Ese nombre de enlace está reservado' using errcode = 'P0001';
  end if;

  insert into public.stores (owner_id, name, slug)
  values (v_user, trim(p_name), lower(trim(p_slug)))
  returning id into v_store_id;

  insert into public.store_members (store_id, user_id, role) values (v_store_id, v_user, 'owner');
  insert into public.store_settings (store_id) values (v_store_id);

  return v_store_id;
end;
$$;
grant execute on function public.create_store(text, text) to authenticated;

-- ---------------------------------------------------------------------
-- Máquina de estados del pedido
-- Cadena principal: new → pending_confirmation → confirmed → preparing
--                   → shipped → out_for_delivery → delivered → collected
-- Se puede avanzar saltando pasos (los hitos saltados se completan).
-- cancelled: solo antes de salir. failed_delivery: solo después de salir.
-- returned: solo desde failed_delivery. cancelled se puede reabrir.
-- (Espejo en TypeScript: src/modules/orders/state-machine.ts)
-- ---------------------------------------------------------------------
create or replace function public.order_status_rank(p_status public.order_status)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_status
    when 'new' then 0
    when 'pending_confirmation' then 1
    when 'confirmed' then 2
    when 'preparing' then 3
    when 'shipped' then 4
    when 'out_for_delivery' then 5
    when 'delivered' then 6
    when 'collected' then 7
    else null
  end;
$$;

create or replace function public.order_transition_allowed(
  p_from public.order_status,
  p_to public.order_status
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when p_from = p_to then false
    when public.order_status_rank(p_from) is not null and public.order_status_rank(p_to) is not null
      then public.order_status_rank(p_to) > public.order_status_rank(p_from)
    when p_to = 'cancelled'
      then p_from in ('new', 'pending_confirmation', 'confirmed', 'preparing')
    when p_to = 'failed_delivery'
      then p_from in ('shipped', 'out_for_delivery')
    when p_to = 'returned'
      then p_from = 'failed_delivery'
    when p_from = 'cancelled'
      then p_to in ('new', 'pending_confirmation')
    else false
  end;
$$;

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
  v_rank integer := public.order_status_rank(p_to);
  v_now timestamptz := now();
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'Pedido no encontrado' using errcode = 'P0002';
  end if;

  v_from := v_order.status;
  if not public.order_transition_allowed(v_from, p_to) then
    raise exception 'No se puede pasar de % a %', v_from, p_to using errcode = 'P0001';
  end if;

  update public.orders o set
    status = p_to,
    confirmed_at = case when v_rank >= 2 then coalesce(o.confirmed_at, v_now) else o.confirmed_at end,
    shipped_at   = case when v_rank >= 4 then coalesce(o.shipped_at, v_now) else o.shipped_at end,
    delivered_at = case when v_rank >= 6 then coalesce(o.delivered_at, v_now) else o.delivered_at end,
    collected_at = case when v_rank >= 7 then coalesce(o.collected_at, v_now) else o.collected_at end,
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

-- Llamada desde el panel del vendedor.
create or replace function public.change_order_status(
  p_order_id uuid,
  p_to public.order_status,
  p_note text default null
)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_store_id uuid;
begin
  select store_id into v_store_id from public.orders where id = p_order_id;
  if v_store_id is null or not public.is_store_member(v_store_id) then
    raise exception 'Pedido no encontrado' using errcode = 'P0002';
  end if;
  return public.apply_order_status(p_order_id, p_to, 'manual', (select auth.uid()), p_note);
end;
$$;
grant execute on function public.change_order_status(uuid, public.order_status, text) to authenticated;

-- ---------------------------------------------------------------------
-- Publicar / despublicar landing
-- ---------------------------------------------------------------------
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
  if not found or not public.is_store_member(v_landing.store_id) then
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
  if not found or not public.is_store_member(v_landing.store_id) then
    raise exception 'Landing no encontrada' using errcode = 'P0002';
  end if;
  update public.landing_pages set status = 'draft' where id = p_landing_id returning * into v_landing;
  return v_landing;
end;
$$;
grant execute on function public.unpublish_landing_page(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Landing pública: devuelve SOLO lo necesario para renderizar.
-- ---------------------------------------------------------------------
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
      'settings', l.settings,
      'published_at', l.published_at
    ),
    'store', jsonb_build_object(
      'id', s.id,
      'slug', s.slug,
      'name', s.name,
      'currency', s.currency,
      'whatsapp', ss.whatsapp,
      'logo_path', ss.logo_path,
      'favicon_path', ss.favicon_path,
      'shipping_lima', ss.shipping_lima,
      'shipping_province', ss.shipping_province,
      'advance_amount', ss.advance_amount,
      'payment_methods', to_jsonb(ss.payment_methods),
      'confirmation_message', ss.confirmation_message
    ),
    'product', jsonb_build_object(
      'id', p.id,
      'name', p.name,
      'description', p.description,
      'price', p.price,
      'compare_at_price', p.compare_at_price,
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
  join public.products p on p.id = l.product_id
  where s.slug = lower(p_store_slug)
    and l.slug = lower(p_slug)
    and l.status = 'published'
    and s.status = 'active'
    and p.status = 'active';
$$;
grant execute on function public.get_public_landing(text, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Crear pedido COD (llamada SOLO desde el servidor con service role).
-- Precios, envío y ubicación se calculan AQUÍ; nunca se confía en el navegador.
-- ---------------------------------------------------------------------
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
  v_phone text := p ->> 'phone';
  v_idem text := nullif(p ->> 'idempotency_key', '');
  v_first text := trim(p ->> 'first_name');
  v_last text := nullif(trim(coalesce(p ->> 'last_name', '')), '');
  v_dup boolean;
  a jsonb := coalesce(p -> 'attribution', '{}'::jsonb);
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

  -- Ubicación válida (la jerarquía la garantizan las FK + checks)
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

  -- Montos: Lima Metropolitana (1501) y Callao (0701) pagan envío Lima
  v_shipping := case when v_province.code in ('1501', '0701')
                     then v_settings.shipping_lima else v_settings.shipping_province end;
  v_subtotal := v_offer.price;
  v_total := v_subtotal + v_shipping;
  v_advance := least(v_settings.advance_amount, v_total);

  -- Cliente (por teléfono dentro de la tienda)
  insert into public.customers as c (store_id, first_name, last_name, phone, whatsapp, dni, address, reference, district_code)
  values (v_store.id, v_first, v_last, v_phone, nullif(p ->> 'whatsapp', ''), nullif(p ->> 'dni', ''),
          trim(p ->> 'address'), nullif(trim(coalesce(p ->> 'reference', '')), ''), v_district.code)
  on conflict (store_id, phone) do update set
    first_name = excluded.first_name,
    last_name = coalesce(excluded.last_name, c.last_name),
    whatsapp = coalesce(excluded.whatsapp, c.whatsapp),
    dni = coalesce(excluded.dni, c.dni),
    address = excluded.address,
    reference = excluded.reference,
    district_code = excluded.district_code
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
    customer_name, customer_phone,
    department_code, department_name, province_code, province_name, district_code, district_name,
    address, reference, dni, delivery_method, customer_notes,
    idempotency_key, is_possible_duplicate
  ) values (
    v_store.id, v_order_number, v_customer_id, v_landing.id, 'new',
    v_subtotal, v_shipping, v_total, v_advance, v_total - v_advance,
    v_product.cost * v_offer.quantity, 0,
    trim(v_first || ' ' || coalesce(v_last, '')), v_phone,
    v_department.code, v_department.name, v_province.code, v_province.name, v_district.code, v_district.name,
    trim(p ->> 'address'), nullif(trim(coalesce(p ->> 'reference', '')), ''), nullif(p ->> 'dni', ''),
    nullif(p ->> 'delivery_method', ''), nullif(trim(coalesce(p ->> 'notes', '')), ''),
    v_idem, v_dup
  )
  returning * into v_order;

  insert into public.order_items (store_id, order_id, product_id, offer_id, product_name, offer_name, quantity, line_price, unit_cost)
  values (v_store.id, v_order.id, v_product.id, v_offer.id, v_product.name, v_offer.name, v_offer.quantity, v_offer.price, v_product.cost);

  insert into public.order_status_history (store_id, order_id, from_status, to_status, source)
  values (v_store.id, v_order.id, null, 'new', 'system');

  insert into public.order_attribution (
    order_id, store_id, utm_source, utm_medium, utm_campaign, utm_content, utm_term,
    fbclid, fbc, fbp, campaign_id, adset_id, ad_id, landing_page_id, referrer, landing_url,
    client_ip, user_agent
  ) values (
    v_order.id, v_store.id,
    left(a ->> 'utm_source', 255), left(a ->> 'utm_medium', 255), left(a ->> 'utm_campaign', 255),
    left(a ->> 'utm_content', 255), left(a ->> 'utm_term', 255),
    left(a ->> 'fbclid', 512), left(a ->> 'fbc', 600), left(a ->> 'fbp', 255),
    left(a ->> 'campaign_id', 64), left(a ->> 'adset_id', 64), left(a ->> 'ad_id', 64),
    v_landing.id, left(a ->> 'referrer', 1000), left(a ->> 'landing_url', 2000),
    nullif(p ->> 'client_ip', '')::inet, left(p ->> 'user_agent', 1000)
  );

  return jsonb_build_object('order_id', v_order.id, 'order_number', v_order.order_number,
                            'total', v_order.total, 'duplicate_submit', false);
end;
$$;
revoke all on function public.create_cod_order(jsonb) from public, anon, authenticated;
grant execute on function public.create_cod_order(jsonb) to service_role;

-- ---------------------------------------------------------------------
-- Conteos de pedidos para el dashboard (cohorte: pedidos CREADOS en el rango).
-- Los cálculos derivados (CPA, ROAS, utilidad) viven en src/modules/metrics.
-- ---------------------------------------------------------------------
create or replace function public.get_order_stats(p_store_id uuid, p_from timestamptz, p_to timestamptz)
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
      'in_progress', count(*) filter (where o.status in ('new', 'pending_confirmation', 'confirmed', 'preparing', 'shipped', 'out_for_delivery')),
      'revenue', coalesce(sum(o.total) filter (where o.delivered_at is not null and o.status not in ('failed_delivery', 'returned')), 0),
      'product_cost', coalesce(sum(o.product_cost_total) filter (where o.delivered_at is not null and o.status not in ('failed_delivery', 'returned')), 0),
      'shipping_cost', coalesce(sum(o.shipping_cost) filter (where o.shipped_at is not null), 0)
    )
    from public.orders o
    where o.store_id = p_store_id
      and o.created_at >= p_from
      and o.created_at < p_to
  );
end;
$$;
grant execute on function public.get_order_stats(uuid, timestamptz, timestamptz) to authenticated;

-- >>> supabase/migrations/20261008000400_storage.sql
-- =====================================================================
-- Vendia — Storage
-- Bucket público de lectura (imágenes de landings/productos).
-- Ruta obligatoria: {store_id}/...  → solo miembros de esa tienda escriben.
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'store-assets',
  'store-assets',
  true,
  5242880, -- 5 MB
  array['image/webp', 'image/jpeg', 'image/png', 'image/gif', 'image/avif', 'image/x-icon', 'image/svg+xml']
)
on conflict (id) do nothing;

create or replace function public.storage_path_store_id(p_name text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  return (storage.foldername(p_name))[1]::uuid;
exception when others then
  return null;
end;
$$;
grant execute on function public.storage_path_store_id(text) to authenticated;

create policy "store-assets: miembros suben"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'store-assets' and public.is_store_member(public.storage_path_store_id(name)));

create policy "store-assets: miembros actualizan"
  on storage.objects for update to authenticated
  using (bucket_id = 'store-assets' and public.is_store_member(public.storage_path_store_id(name)))
  with check (bucket_id = 'store-assets' and public.is_store_member(public.storage_path_store_id(name)));

create policy "store-assets: miembros eliminan"
  on storage.objects for delete to authenticated
  using (bucket_id = 'store-assets' and public.is_store_member(public.storage_path_store_id(name)));

create policy "store-assets: miembros listan"
  on storage.objects for select to authenticated
  using (bucket_id = 'store-assets' and public.is_store_member(public.storage_path_store_id(name)));

-- >>> supabase/migrations/20261008000500_ubigeo_seed.sql
-- =====================================================================
-- Vendia — Ubigeo del Perú (INEI 2022, 1,891 distritos + provisionales)
-- GENERADO por scripts/build-ubigeo-seed.ts — no editar a mano.
-- Departamentos: 25 · Provincias: 196 · Distritos: 1893
-- =====================================================================

insert into public.ubigeo_departments (code, name) values
  ('01', 'Amazonas'),
  ('02', 'Ancash'),
  ('03', 'Apurimac'),
  ('04', 'Arequipa'),
  ('05', 'Ayacucho'),
  ('06', 'Cajamarca'),
  ('07', 'Callao'),
  ('08', 'Cusco'),
  ('09', 'Huancavelica'),
  ('10', 'Huanuco'),
  ('11', 'Ica'),
  ('12', 'Junin'),
  ('13', 'La Libertad'),
  ('14', 'Lambayeque'),
  ('15', 'Lima'),
  ('16', 'Loreto'),
  ('17', 'Madre de Dios'),
  ('18', 'Moquegua'),
  ('19', 'Pasco'),
  ('20', 'Piura'),
  ('21', 'Puno'),
  ('22', 'San Martin'),
  ('23', 'Tacna'),
  ('24', 'Tumbes'),
  ('25', 'Ucayali')
on conflict (code) do update set name = excluded.name;

insert into public.ubigeo_provinces (code, department_code, name) values
  ('0101', '01', 'Chachapoyas'),
  ('0102', '01', 'Bagua'),
  ('0103', '01', 'Bongara'),
  ('0104', '01', 'Condorcanqui'),
  ('0105', '01', 'Luya'),
  ('0106', '01', 'Rodriguez de Mendoza'),
  ('0107', '01', 'Utcubamba'),
  ('0201', '02', 'Huaraz'),
  ('0202', '02', 'Aija'),
  ('0203', '02', 'Antonio Raymondi'),
  ('0204', '02', 'Asuncion'),
  ('0205', '02', 'Bolognesi'),
  ('0206', '02', 'Carhuaz'),
  ('0207', '02', 'Carlos Fermin Fitzcarrald'),
  ('0208', '02', 'Casma'),
  ('0209', '02', 'Corongo'),
  ('0210', '02', 'Huari'),
  ('0211', '02', 'Huarmey'),
  ('0212', '02', 'Huaylas'),
  ('0213', '02', 'Mariscal Luzuriaga'),
  ('0214', '02', 'Ocros'),
  ('0215', '02', 'Pallasca'),
  ('0216', '02', 'Pomabamba'),
  ('0217', '02', 'Recuay'),
  ('0218', '02', 'Santa'),
  ('0219', '02', 'Sihuas'),
  ('0220', '02', 'Yungay'),
  ('0301', '03', 'Abancay'),
  ('0302', '03', 'Andahuaylas'),
  ('0303', '03', 'Antabamba'),
  ('0304', '03', 'Aymaraes'),
  ('0305', '03', 'Cotabambas'),
  ('0306', '03', 'Chincheros'),
  ('0307', '03', 'Grau'),
  ('0401', '04', 'Arequipa'),
  ('0402', '04', 'Camana'),
  ('0403', '04', 'Caraveli'),
  ('0404', '04', 'Castilla'),
  ('0405', '04', 'Caylloma'),
  ('0406', '04', 'Condesuyos'),
  ('0407', '04', 'Islay'),
  ('0408', '04', 'La Union'),
  ('0501', '05', 'Huamanga'),
  ('0502', '05', 'Cangallo'),
  ('0503', '05', 'Huanca Sancos'),
  ('0504', '05', 'Huanta'),
  ('0505', '05', 'La Mar'),
  ('0506', '05', 'Lucanas'),
  ('0507', '05', 'Parinacochas'),
  ('0508', '05', 'Paucar del Sara Sara'),
  ('0509', '05', 'Sucre'),
  ('0510', '05', 'Victor Fajardo'),
  ('0511', '05', 'Vilcas Huaman'),
  ('0601', '06', 'Cajamarca'),
  ('0602', '06', 'Cajabamba'),
  ('0603', '06', 'Celendin'),
  ('0604', '06', 'Chota'),
  ('0605', '06', 'Contumaza'),
  ('0606', '06', 'Cutervo'),
  ('0607', '06', 'Hualgayoc'),
  ('0608', '06', 'Jaen'),
  ('0609', '06', 'San Ignacio'),
  ('0610', '06', 'San Marcos'),
  ('0611', '06', 'San Miguel'),
  ('0612', '06', 'San Pablo'),
  ('0613', '06', 'Santa Cruz'),
  ('0701', '07', 'Callao'),
  ('0801', '08', 'Cusco'),
  ('0802', '08', 'Acomayo'),
  ('0803', '08', 'Anta'),
  ('0804', '08', 'Calca'),
  ('0805', '08', 'Canas'),
  ('0806', '08', 'Canchis'),
  ('0807', '08', 'Chumbivilcas'),
  ('0808', '08', 'Espinar'),
  ('0809', '08', 'La Convencion'),
  ('0810', '08', 'Paruro'),
  ('0811', '08', 'Paucartambo'),
  ('0812', '08', 'Quispicanchi'),
  ('0813', '08', 'Urubamba'),
  ('0901', '09', 'Huancavelica'),
  ('0902', '09', 'Acobamba'),
  ('0903', '09', 'Angaraes'),
  ('0904', '09', 'Castrovirreyna'),
  ('0905', '09', 'Churcampa'),
  ('0906', '09', 'Huaytara'),
  ('0907', '09', 'Tayacaja'),
  ('1001', '10', 'Huanuco'),
  ('1002', '10', 'Ambo'),
  ('1003', '10', 'Dos de Mayo'),
  ('1004', '10', 'Huacaybamba'),
  ('1005', '10', 'Huamalies'),
  ('1006', '10', 'Leoncio Prado'),
  ('1007', '10', 'Marañon'),
  ('1008', '10', 'Pachitea'),
  ('1009', '10', 'Puerto Inca'),
  ('1010', '10', 'Lauricocha'),
  ('1011', '10', 'Yarowilca'),
  ('1101', '11', 'Ica'),
  ('1102', '11', 'Chincha'),
  ('1103', '11', 'Nasca'),
  ('1104', '11', 'Palpa'),
  ('1105', '11', 'Pisco'),
  ('1201', '12', 'Huancayo'),
  ('1202', '12', 'Concepcion'),
  ('1203', '12', 'Chanchamayo'),
  ('1204', '12', 'Jauja'),
  ('1205', '12', 'Junin'),
  ('1206', '12', 'Satipo'),
  ('1207', '12', 'Tarma'),
  ('1208', '12', 'Yauli'),
  ('1209', '12', 'Chupaca'),
  ('1301', '13', 'Trujillo'),
  ('1302', '13', 'Ascope'),
  ('1303', '13', 'Bolivar'),
  ('1304', '13', 'Chepen'),
  ('1305', '13', 'Julcan'),
  ('1306', '13', 'Otuzco'),
  ('1307', '13', 'Pacasmayo'),
  ('1308', '13', 'Pataz'),
  ('1309', '13', 'Sanchez Carrion'),
  ('1310', '13', 'Santiago de Chuco'),
  ('1311', '13', 'Gran Chimu'),
  ('1312', '13', 'Viru'),
  ('1401', '14', 'Chiclayo'),
  ('1402', '14', 'Ferreñafe'),
  ('1403', '14', 'Lambayeque'),
  ('1501', '15', 'Lima'),
  ('1502', '15', 'Barranca'),
  ('1503', '15', 'Cajatambo'),
  ('1504', '15', 'Canta'),
  ('1505', '15', 'Cañete'),
  ('1506', '15', 'Huaral'),
  ('1507', '15', 'Huarochiri'),
  ('1508', '15', 'Huaura'),
  ('1509', '15', 'Oyon'),
  ('1510', '15', 'Yauyos'),
  ('1601', '16', 'Maynas'),
  ('1602', '16', 'Alto Amazonas'),
  ('1603', '16', 'Loreto'),
  ('1604', '16', 'Mariscal Ramon Castilla'),
  ('1605', '16', 'Requena'),
  ('1606', '16', 'Ucayali'),
  ('1607', '16', 'Datem del Marañon'),
  ('1608', '16', 'Putumayo'),
  ('1701', '17', 'Tambopata'),
  ('1702', '17', 'Manu'),
  ('1703', '17', 'Tahuamanu'),
  ('1801', '18', 'Mariscal Nieto'),
  ('1802', '18', 'General Sanchez Cerro'),
  ('1803', '18', 'Ilo'),
  ('1901', '19', 'Pasco'),
  ('1902', '19', 'Daniel Alcides Carrion'),
  ('1903', '19', 'Oxapampa'),
  ('2001', '20', 'Piura'),
  ('2002', '20', 'Ayabaca'),
  ('2003', '20', 'Huancabamba'),
  ('2004', '20', 'Morropon'),
  ('2005', '20', 'Paita'),
  ('2006', '20', 'Sullana'),
  ('2007', '20', 'Talara'),
  ('2008', '20', 'Sechura'),
  ('2101', '21', 'Puno'),
  ('2102', '21', 'Azangaro'),
  ('2103', '21', 'Carabaya'),
  ('2104', '21', 'Chucuito'),
  ('2105', '21', 'El Collao'),
  ('2106', '21', 'Huancane'),
  ('2107', '21', 'Lampa'),
  ('2108', '21', 'Melgar'),
  ('2109', '21', 'Moho'),
  ('2110', '21', 'San Antonio de Putina'),
  ('2111', '21', 'San Roman'),
  ('2112', '21', 'Sandia'),
  ('2113', '21', 'Yunguyo'),
  ('2201', '22', 'Moyobamba'),
  ('2202', '22', 'Bellavista'),
  ('2203', '22', 'El Dorado'),
  ('2204', '22', 'Huallaga'),
  ('2205', '22', 'Lamas'),
  ('2206', '22', 'Mariscal Caceres'),
  ('2207', '22', 'Picota'),
  ('2208', '22', 'Rioja'),
  ('2209', '22', 'San Martin'),
  ('2210', '22', 'Tocache'),
  ('2301', '23', 'Tacna'),
  ('2302', '23', 'Candarave'),
  ('2303', '23', 'Jorge Basadre'),
  ('2304', '23', 'Tarata'),
  ('2401', '24', 'Tumbes'),
  ('2402', '24', 'Contralmirante Villar'),
  ('2403', '24', 'Zarumilla'),
  ('2501', '25', 'Coronel Portillo'),
  ('2502', '25', 'Atalaya'),
  ('2503', '25', 'Padre Abad'),
  ('2504', '25', 'Purus')
on conflict (code) do update set name = excluded.name, department_code = excluded.department_code;

insert into public.ubigeo_districts (code, province_code, name, is_provisional) values
  ('010101', '0101', 'Chachapoyas', false),
  ('010102', '0101', 'Asuncion', false),
  ('010103', '0101', 'Balsas', false),
  ('010104', '0101', 'Cheto', false),
  ('010105', '0101', 'Chiliquin', false),
  ('010106', '0101', 'Chuquibamba', false),
  ('010107', '0101', 'Granada', false),
  ('010108', '0101', 'Huancas', false),
  ('010109', '0101', 'La Jalca', false),
  ('010110', '0101', 'Leimebamba', false),
  ('010111', '0101', 'Levanto', false),
  ('010112', '0101', 'Magdalena', false),
  ('010113', '0101', 'Mariscal Castilla', false),
  ('010114', '0101', 'Molinopampa', false),
  ('010115', '0101', 'Montevideo', false),
  ('010116', '0101', 'Olleros', false),
  ('010117', '0101', 'Quinjalca', false),
  ('010118', '0101', 'San Francisco de Daguas', false),
  ('010119', '0101', 'San Isidro de Maino', false),
  ('010120', '0101', 'Soloco', false),
  ('010121', '0101', 'Sonche', false),
  ('010201', '0102', 'Bagua', false),
  ('010202', '0102', 'Aramango', false),
  ('010203', '0102', 'Copallin', false),
  ('010204', '0102', 'El Parco', false),
  ('010205', '0102', 'Imaza', false),
  ('010206', '0102', 'La Peca', false),
  ('010301', '0103', 'Jumbilla', false),
  ('010302', '0103', 'Chisquilla', false),
  ('010303', '0103', 'Churuja', false),
  ('010304', '0103', 'Corosha', false),
  ('010305', '0103', 'Cuispes', false),
  ('010306', '0103', 'Florida', false),
  ('010307', '0103', 'Jazan', false),
  ('010308', '0103', 'Recta', false),
  ('010309', '0103', 'San Carlos', false),
  ('010310', '0103', 'Shipasbamba', false),
  ('010311', '0103', 'Valera', false),
  ('010312', '0103', 'Yambrasbamba', false),
  ('010401', '0104', 'Nieva', false),
  ('010402', '0104', 'El Cenepa', false),
  ('010403', '0104', 'Rio Santiago', false),
  ('010501', '0105', 'Lamud', false),
  ('010502', '0105', 'Camporredondo', false),
  ('010503', '0105', 'Cocabamba', false),
  ('010504', '0105', 'Colcamar', false),
  ('010505', '0105', 'Conila', false),
  ('010506', '0105', 'Inguilpata', false),
  ('010507', '0105', 'Longuita', false),
  ('010508', '0105', 'Lonya Chico', false),
  ('010509', '0105', 'Luya', false),
  ('010510', '0105', 'Luya Viejo', false),
  ('010511', '0105', 'Maria', false),
  ('010512', '0105', 'Ocalli', false),
  ('010513', '0105', 'Ocumal', false),
  ('010514', '0105', 'Pisuquia', false),
  ('010515', '0105', 'Providencia', false),
  ('010516', '0105', 'San Cristobal', false),
  ('010517', '0105', 'San Francisco del Yeso', false),
  ('010518', '0105', 'San Jeronimo', false),
  ('010519', '0105', 'San Juan de Lopecancha', false),
  ('010520', '0105', 'Santa Catalina', false),
  ('010521', '0105', 'Santo Tomas', false),
  ('010522', '0105', 'Tingo', false),
  ('010523', '0105', 'Trita', false),
  ('010601', '0106', 'San Nicolas', false),
  ('010602', '0106', 'Chirimoto', false),
  ('010603', '0106', 'Cochamal', false),
  ('010604', '0106', 'Huambo', false),
  ('010605', '0106', 'Limabamba', false),
  ('010606', '0106', 'Longar', false),
  ('010607', '0106', 'Mariscal Benavides', false),
  ('010608', '0106', 'Milpuc', false),
  ('010609', '0106', 'Omia', false),
  ('010610', '0106', 'Santa Rosa', false),
  ('010611', '0106', 'Totora', false),
  ('010612', '0106', 'Vista Alegre', false),
  ('010701', '0107', 'Bagua Grande', false),
  ('010702', '0107', 'Cajaruro', false),
  ('010703', '0107', 'Cumba', false),
  ('010704', '0107', 'El Milagro', false),
  ('010705', '0107', 'Jamalca', false),
  ('010706', '0107', 'Lonya Grande', false),
  ('010707', '0107', 'Yamon', false),
  ('020101', '0201', 'Huaraz', false),
  ('020102', '0201', 'Cochabamba', false),
  ('020103', '0201', 'Colcabamba', false),
  ('020104', '0201', 'Huanchay', false),
  ('020105', '0201', 'Independencia', false),
  ('020106', '0201', 'Jangas', false),
  ('020107', '0201', 'La Libertad', false),
  ('020108', '0201', 'Olleros', false),
  ('020109', '0201', 'Pampas Grande', false),
  ('020110', '0201', 'Pariacoto', false),
  ('020111', '0201', 'Pira', false),
  ('020112', '0201', 'Tarica', false),
  ('020201', '0202', 'Aija', false),
  ('020202', '0202', 'Coris', false),
  ('020203', '0202', 'Huacllan', false),
  ('020204', '0202', 'La Merced', false),
  ('020205', '0202', 'Succha', false),
  ('020301', '0203', 'Llamellin', false),
  ('020302', '0203', 'Aczo', false),
  ('020303', '0203', 'Chaccho', false),
  ('020304', '0203', 'Chingas', false),
  ('020305', '0203', 'Mirgas', false),
  ('020306', '0203', 'San Juan de Rontoy', false),
  ('020401', '0204', 'Chacas', false),
  ('020402', '0204', 'Acochaca', false),
  ('020501', '0205', 'Chiquian', false),
  ('020502', '0205', 'Abelardo Pardo Lezameta', false),
  ('020503', '0205', 'Antonio Raymondi', false),
  ('020504', '0205', 'Aquia', false),
  ('020505', '0205', 'Cajacay', false),
  ('020506', '0205', 'Canis', false),
  ('020507', '0205', 'Colquioc', false),
  ('020508', '0205', 'Huallanca', false),
  ('020509', '0205', 'Huasta', false),
  ('020510', '0205', 'Huayllacayan', false),
  ('020511', '0205', 'La Primavera', false),
  ('020512', '0205', 'Mangas', false),
  ('020513', '0205', 'Pacllon', false),
  ('020514', '0205', 'San Miguel de Corpanqui', false),
  ('020515', '0205', 'Ticllos', false),
  ('020601', '0206', 'Carhuaz', false),
  ('020602', '0206', 'Acopampa', false),
  ('020603', '0206', 'Amashca', false),
  ('020604', '0206', 'Anta', false),
  ('020605', '0206', 'Ataquero', false),
  ('020606', '0206', 'Marcara', false),
  ('020607', '0206', 'Pariahuanca', false),
  ('020608', '0206', 'San Miguel de Aco', false),
  ('020609', '0206', 'Shilla', false),
  ('020610', '0206', 'Tinco', false),
  ('020611', '0206', 'Yungar', false),
  ('020701', '0207', 'San Luis', false),
  ('020702', '0207', 'San Nicolas', false),
  ('020703', '0207', 'Yauya', false),
  ('020801', '0208', 'Casma', false),
  ('020802', '0208', 'Buena Vista Alta', false),
  ('020803', '0208', 'Comandante Noel', false),
  ('020804', '0208', 'Yautan', false),
  ('020901', '0209', 'Corongo', false),
  ('020902', '0209', 'Aco', false),
  ('020903', '0209', 'Bambas', false),
  ('020904', '0209', 'Cusca', false),
  ('020905', '0209', 'La Pampa', false),
  ('020906', '0209', 'Yanac', false),
  ('020907', '0209', 'Yupan', false),
  ('021001', '0210', 'Huari', false),
  ('021002', '0210', 'Anra', false),
  ('021003', '0210', 'Cajay', false),
  ('021004', '0210', 'Chavin de Huantar', false),
  ('021005', '0210', 'Huacachi', false),
  ('021006', '0210', 'Huacchis', false),
  ('021007', '0210', 'Huachis', false),
  ('021008', '0210', 'Huantar', false),
  ('021009', '0210', 'Masin', false),
  ('021010', '0210', 'Paucas', false),
  ('021011', '0210', 'Ponto', false),
  ('021012', '0210', 'Rahuapampa', false),
  ('021013', '0210', 'Rapayan', false),
  ('021014', '0210', 'San Marcos', false),
  ('021015', '0210', 'San Pedro de Chana', false),
  ('021016', '0210', 'Uco', false),
  ('021101', '0211', 'Huarmey', false),
  ('021102', '0211', 'Cochapeti', false),
  ('021103', '0211', 'Culebras', false),
  ('021104', '0211', 'Huayan', false),
  ('021105', '0211', 'Malvas', false),
  ('021201', '0212', 'Caraz', false),
  ('021202', '0212', 'Huallanca', false),
  ('021203', '0212', 'Huata', false),
  ('021204', '0212', 'Huaylas', false),
  ('021205', '0212', 'Mato', false),
  ('021206', '0212', 'Pamparomas', false),
  ('021207', '0212', 'Pueblo Libre', false),
  ('021208', '0212', 'Santa Cruz', false),
  ('021209', '0212', 'Santo Toribio', false),
  ('021210', '0212', 'Yuracmarca', false),
  ('021301', '0213', 'Piscobamba', false),
  ('021302', '0213', 'Casca', false),
  ('021303', '0213', 'Eleazar Guzman Barron', false),
  ('021304', '0213', 'Fidel Olivas Escudero', false),
  ('021305', '0213', 'Llama', false),
  ('021306', '0213', 'Llumpa', false),
  ('021307', '0213', 'Lucma', false),
  ('021308', '0213', 'Musga', false),
  ('021401', '0214', 'Ocros', false),
  ('021402', '0214', 'Acas', false),
  ('021403', '0214', 'Cajamarquilla', false),
  ('021404', '0214', 'Carhuapampa', false),
  ('021405', '0214', 'Cochas', false),
  ('021406', '0214', 'Congas', false),
  ('021407', '0214', 'Llipa', false),
  ('021408', '0214', 'San Cristobal de Rajan', false),
  ('021409', '0214', 'San Pedro', false),
  ('021410', '0214', 'Santiago de Chilcas', false),
  ('021501', '0215', 'Cabana', false),
  ('021502', '0215', 'Bolognesi', false),
  ('021503', '0215', 'Conchucos', false),
  ('021504', '0215', 'Huacaschuque', false),
  ('021505', '0215', 'Huandoval', false),
  ('021506', '0215', 'Lacabamba', false),
  ('021507', '0215', 'Llapo', false),
  ('021508', '0215', 'Pallasca', false),
  ('021509', '0215', 'Pampas', false),
  ('021510', '0215', 'Santa Rosa', false),
  ('021511', '0215', 'Tauca', false),
  ('021601', '0216', 'Pomabamba', false),
  ('021602', '0216', 'Huayllan', false),
  ('021603', '0216', 'Parobamba', false),
  ('021604', '0216', 'Quinuabamba', false),
  ('021701', '0217', 'Recuay', false),
  ('021702', '0217', 'Catac', false),
  ('021703', '0217', 'Cotaparaco', false),
  ('021704', '0217', 'Huayllapampa', false),
  ('021705', '0217', 'Llacllin', false),
  ('021706', '0217', 'Marca', false),
  ('021707', '0217', 'Pampas Chico', false),
  ('021708', '0217', 'Pararin', false),
  ('021709', '0217', 'Tapacocha', false),
  ('021710', '0217', 'Ticapampa', false),
  ('021801', '0218', 'Chimbote', false),
  ('021802', '0218', 'Caceres del Peru', false),
  ('021803', '0218', 'Coishco', false),
  ('021804', '0218', 'Macate', false),
  ('021805', '0218', 'Moro', false),
  ('021806', '0218', 'Nepeña', false),
  ('021807', '0218', 'Samanco', false),
  ('021808', '0218', 'Santa', false),
  ('021809', '0218', 'Nuevo Chimbote', false),
  ('021901', '0219', 'Sihuas', false),
  ('021902', '0219', 'Acobamba', false),
  ('021903', '0219', 'Alfonso Ugarte', false),
  ('021904', '0219', 'Cashapampa', false),
  ('021905', '0219', 'Chingalpo', false),
  ('021906', '0219', 'Huayllabamba', false),
  ('021907', '0219', 'Quiches', false),
  ('021908', '0219', 'Ragash', false),
  ('021909', '0219', 'San Juan', false),
  ('021910', '0219', 'Sicsibamba', false),
  ('022001', '0220', 'Yungay', false),
  ('022002', '0220', 'Cascapara', false),
  ('022003', '0220', 'Mancos', false),
  ('022004', '0220', 'Matacoto', false),
  ('022005', '0220', 'Quillo', false),
  ('022006', '0220', 'Ranrahirca', false),
  ('022007', '0220', 'Shupluy', false),
  ('022008', '0220', 'Yanama', false),
  ('030101', '0301', 'Abancay', false),
  ('030102', '0301', 'Chacoche', false),
  ('030103', '0301', 'Circa', false),
  ('030104', '0301', 'Curahuasi', false),
  ('030105', '0301', 'Huanipaca', false),
  ('030106', '0301', 'Lambrama', false),
  ('030107', '0301', 'Pichirhua', false),
  ('030108', '0301', 'San Pedro de Cachora', false),
  ('030109', '0301', 'Tamburco', false),
  ('030201', '0302', 'Andahuaylas', false),
  ('030202', '0302', 'Andarapa', false),
  ('030203', '0302', 'Chiara', false),
  ('030204', '0302', 'Huancarama', false),
  ('030205', '0302', 'Huancaray', false),
  ('030206', '0302', 'Huayana', false),
  ('030207', '0302', 'Kishuara', false),
  ('030208', '0302', 'Pacobamba', false),
  ('030209', '0302', 'Pacucha', false),
  ('030210', '0302', 'Pampachiri', false),
  ('030211', '0302', 'Pomacocha', false),
  ('030212', '0302', 'San Antonio de Cachi', false),
  ('030213', '0302', 'San Jeronimo', false),
  ('030214', '0302', 'San Miguel de Chaccrampa', false),
  ('030215', '0302', 'Santa Maria de Chicmo', false),
  ('030216', '0302', 'Talavera', false),
  ('030217', '0302', 'Tumay Huaraca', false),
  ('030218', '0302', 'Turpo', false),
  ('030219', '0302', 'Kaquiabamba', false),
  ('030220', '0302', 'Jose Maria Arguedas', false),
  ('030301', '0303', 'Antabamba', false),
  ('030302', '0303', 'El Oro', false),
  ('030303', '0303', 'Huaquirca', false),
  ('030304', '0303', 'Juan Espinoza Medrano', false),
  ('030305', '0303', 'Oropesa', false),
  ('030306', '0303', 'Pachaconas', false),
  ('030307', '0303', 'Sabaino', false),
  ('030401', '0304', 'Chalhuanca', false),
  ('030402', '0304', 'Capaya', false),
  ('030403', '0304', 'Caraybamba', false),
  ('030404', '0304', 'Chapimarca', false),
  ('030405', '0304', 'Colcabamba', false),
  ('030406', '0304', 'Cotaruse', false),
  ('030407', '0304', 'Ihuayllo', false),
  ('030408', '0304', 'Justo Apu Sahuaraura', false),
  ('030409', '0304', 'Lucre', false),
  ('030410', '0304', 'Pocohuanca', false),
  ('030411', '0304', 'San Juan de Chacña', false),
  ('030412', '0304', 'Sañayca', false),
  ('030413', '0304', 'Soraya', false),
  ('030414', '0304', 'Tapairihua', false),
  ('030415', '0304', 'Tintay', false),
  ('030416', '0304', 'Toraya', false),
  ('030417', '0304', 'Yanaca', false),
  ('030501', '0305', 'Tambobamba', false),
  ('030502', '0305', 'Cotabambas', false),
  ('030503', '0305', 'Coyllurqui', false),
  ('030504', '0305', 'Haquira', false),
  ('030505', '0305', 'Mara', false),
  ('030506', '0305', 'Challhuahuacho', false),
  ('030601', '0306', 'Chincheros', false),
  ('030602', '0306', 'Anco_huallo', false),
  ('030603', '0306', 'Cocharcas', false),
  ('030604', '0306', 'Huaccana', false),
  ('030605', '0306', 'Ocobamba', false),
  ('030606', '0306', 'Ongoy', false),
  ('030607', '0306', 'Uranmarca', false),
  ('030608', '0306', 'Ranracancha', false),
  ('030609', '0306', 'Rocchacc', false),
  ('030610', '0306', 'El Porvenir', false),
  ('030611', '0306', 'Los Chankas', false),
  ('030612', '0306', 'Ahuayro', false),
  ('030701', '0307', 'Chuquibambilla', false),
  ('030702', '0307', 'Curpahuasi', false),
  ('030703', '0307', 'Gamarra', false),
  ('030704', '0307', 'Huayllati', false),
  ('030705', '0307', 'Mamara', false),
  ('030706', '0307', 'Micaela Bastidas', false),
  ('030707', '0307', 'Pataypampa', false),
  ('030708', '0307', 'Progreso', false),
  ('030709', '0307', 'San Antonio', false),
  ('030710', '0307', 'Santa Rosa', false),
  ('030711', '0307', 'Turpay', false),
  ('030712', '0307', 'Vilcabamba', false),
  ('030713', '0307', 'Virundo', false),
  ('030714', '0307', 'Curasco', false),
  ('040101', '0401', 'Arequipa', false),
  ('040102', '0401', 'Alto Selva Alegre', false),
  ('040103', '0401', 'Cayma', false),
  ('040104', '0401', 'Cerro Colorado', false),
  ('040105', '0401', 'Characato', false),
  ('040106', '0401', 'Chiguata', false),
  ('040107', '0401', 'Jacobo Hunter', false),
  ('040108', '0401', 'La Joya', false),
  ('040109', '0401', 'Mariano Melgar', false),
  ('040110', '0401', 'Miraflores', false),
  ('040111', '0401', 'Mollebaya', false),
  ('040112', '0401', 'Paucarpata', false),
  ('040113', '0401', 'Pocsi', false),
  ('040114', '0401', 'Polobaya', false),
  ('040115', '0401', 'Quequeña', false),
  ('040116', '0401', 'Sabandia', false),
  ('040117', '0401', 'Sachaca', false),
  ('040118', '0401', 'San Juan de Siguas', false),
  ('040119', '0401', 'San Juan de Tarucani', false),
  ('040120', '0401', 'Santa Isabel de Siguas', false),
  ('040121', '0401', 'Santa Rita de Siguas', false),
  ('040122', '0401', 'Socabaya', false),
  ('040123', '0401', 'Tiabaya', false),
  ('040124', '0401', 'Uchumayo', false),
  ('040125', '0401', 'Vitor', false),
  ('040126', '0401', 'Yanahuara', false),
  ('040127', '0401', 'Yarabamba', false),
  ('040128', '0401', 'Yura', false),
  ('040129', '0401', 'Jose Luis Bustamante y Rivero', false),
  ('040201', '0402', 'Camana', false),
  ('040202', '0402', 'Jose Maria Quimper', false),
  ('040203', '0402', 'Mariano Nicolas Valcarcel', false),
  ('040204', '0402', 'Mariscal Caceres', false),
  ('040205', '0402', 'Nicolas de Pierola', false),
  ('040206', '0402', 'Ocoña', false),
  ('040207', '0402', 'Quilca', false),
  ('040208', '0402', 'Samuel Pastor', false),
  ('040301', '0403', 'Caraveli', false),
  ('040302', '0403', 'Acari', false),
  ('040303', '0403', 'Atico', false),
  ('040304', '0403', 'Atiquipa', false),
  ('040305', '0403', 'Bella Union', false),
  ('040306', '0403', 'Cahuacho', false),
  ('040307', '0403', 'Chala', false),
  ('040308', '0403', 'Chaparra', false),
  ('040309', '0403', 'Huanuhuanu', false),
  ('040310', '0403', 'Jaqui', false),
  ('040311', '0403', 'Lomas', false),
  ('040312', '0403', 'Quicacha', false),
  ('040313', '0403', 'Yauca', false),
  ('040401', '0404', 'Aplao', false),
  ('040402', '0404', 'Andagua', false),
  ('040403', '0404', 'Ayo', false),
  ('040404', '0404', 'Chachas', false),
  ('040405', '0404', 'Chilcaymarca', false),
  ('040406', '0404', 'Choco', false),
  ('040407', '0404', 'Huancarqui', false),
  ('040408', '0404', 'Machaguay', false),
  ('040409', '0404', 'Orcopampa', false),
  ('040410', '0404', 'Pampacolca', false),
  ('040411', '0404', 'Tipan', false),
  ('040412', '0404', 'Uñon', false),
  ('040413', '0404', 'Uraca', false),
  ('040414', '0404', 'Viraco', false),
  ('040501', '0405', 'Chivay', false),
  ('040502', '0405', 'Achoma', false),
  ('040503', '0405', 'Cabanaconde', false),
  ('040504', '0405', 'Callalli', false),
  ('040505', '0405', 'Caylloma', false),
  ('040506', '0405', 'Coporaque', false),
  ('040507', '0405', 'Huambo', false),
  ('040508', '0405', 'Huanca', false),
  ('040509', '0405', 'Ichupampa', false),
  ('040510', '0405', 'Lari', false),
  ('040511', '0405', 'Lluta', false),
  ('040512', '0405', 'Maca', false),
  ('040513', '0405', 'Madrigal', false),
  ('040514', '0405', 'San Antonio de Chuca', false),
  ('040515', '0405', 'Sibayo', false),
  ('040516', '0405', 'Tapay', false),
  ('040517', '0405', 'Tisco', false),
  ('040518', '0405', 'Tuti', false),
  ('040519', '0405', 'Yanque', false),
  ('040520', '0405', 'Majes', false),
  ('040601', '0406', 'Chuquibamba', false),
  ('040602', '0406', 'Andaray', false),
  ('040603', '0406', 'Cayarani', false),
  ('040604', '0406', 'Chichas', false),
  ('040605', '0406', 'Iray', false),
  ('040606', '0406', 'Rio Grande', false),
  ('040607', '0406', 'Salamanca', false),
  ('040608', '0406', 'Yanaquihua', false),
  ('040701', '0407', 'Mollendo', false),
  ('040702', '0407', 'Cocachacra', false),
  ('040703', '0407', 'Dean Valdivia', false),
  ('040704', '0407', 'Islay', false),
  ('040705', '0407', 'Mejia', false),
  ('040706', '0407', 'Punta de Bombon', false),
  ('040801', '0408', 'Cotahuasi', false),
  ('040802', '0408', 'Alca', false),
  ('040803', '0408', 'Charcana', false),
  ('040804', '0408', 'Huaynacotas', false),
  ('040805', '0408', 'Pampamarca', false),
  ('040806', '0408', 'Puyca', false),
  ('040807', '0408', 'Quechualla', false),
  ('040808', '0408', 'Sayla', false),
  ('040809', '0408', 'Tauria', false),
  ('040810', '0408', 'Tomepampa', false),
  ('040811', '0408', 'Toro', false),
  ('050101', '0501', 'Ayacucho', false),
  ('050102', '0501', 'Acocro', false),
  ('050103', '0501', 'Acos Vinchos', false),
  ('050104', '0501', 'Carmen Alto', false),
  ('050105', '0501', 'Chiara', false),
  ('050106', '0501', 'Ocros', false),
  ('050107', '0501', 'Pacaycasa', false),
  ('050108', '0501', 'Quinua', false),
  ('050109', '0501', 'San Jose de Ticllas', false),
  ('050110', '0501', 'San Juan Bautista', false),
  ('050111', '0501', 'Santiago de Pischa', false),
  ('050112', '0501', 'Socos', false),
  ('050113', '0501', 'Tambillo', false),
  ('050114', '0501', 'Vinchos', false),
  ('050115', '0501', 'Jesus Nazareno', false),
  ('050116', '0501', 'Andres Avelino Caceres Dorregaray', false),
  ('050201', '0502', 'Cangallo', false),
  ('050202', '0502', 'Chuschi', false),
  ('050203', '0502', 'Los Morochucos', false),
  ('050204', '0502', 'Maria Parado de Bellido', false),
  ('050205', '0502', 'Paras', false),
  ('050206', '0502', 'Totos', false),
  ('050301', '0503', 'Sancos', false),
  ('050302', '0503', 'Carapo', false),
  ('050303', '0503', 'Sacsamarca', false),
  ('050304', '0503', 'Santiago de Lucanamarca', false),
  ('050401', '0504', 'Huanta', false),
  ('050402', '0504', 'Ayahuanco', false),
  ('050403', '0504', 'Huamanguilla', false),
  ('050404', '0504', 'Iguain', false),
  ('050405', '0504', 'Luricocha', false),
  ('050406', '0504', 'Santillana', false),
  ('050407', '0504', 'Sivia', false),
  ('050408', '0504', 'Llochegua', false),
  ('050409', '0504', 'Canayre', false),
  ('050410', '0504', 'Uchuraccay', false),
  ('050411', '0504', 'Pucacolpa', false),
  ('050412', '0504', 'Chaca', false),
  ('050413', '0504', 'Putis', false),
  ('050501', '0505', 'San Miguel', false),
  ('050502', '0505', 'Anco', false),
  ('050503', '0505', 'Ayna', false),
  ('050504', '0505', 'Chilcas', false),
  ('050505', '0505', 'Chungui', false),
  ('050506', '0505', 'Luis Carranza', false),
  ('050507', '0505', 'Santa Rosa', false),
  ('050508', '0505', 'Tambo', false),
  ('050509', '0505', 'Samugari', false),
  ('050510', '0505', 'Anchihuay', false),
  ('050511', '0505', 'Oronccoy', false),
  ('050512', '0505', 'Union Progreso', false),
  ('050513', '0505', 'Rio Magdalena', false),
  ('050514', '0505', 'Ninabamba', false),
  ('050515', '0505', 'Patibamba', false),
  ('050601', '0506', 'Puquio', false),
  ('050602', '0506', 'Aucara', false),
  ('050603', '0506', 'Cabana', false),
  ('050604', '0506', 'Carmen Salcedo', false),
  ('050605', '0506', 'Chaviña', false),
  ('050606', '0506', 'Chipao', false),
  ('050607', '0506', 'Huac-Huas', false),
  ('050608', '0506', 'Laramate', false),
  ('050609', '0506', 'Leoncio Prado', false),
  ('050610', '0506', 'Llauta', false),
  ('050611', '0506', 'Lucanas', false),
  ('050612', '0506', 'Ocaña', false),
  ('050613', '0506', 'Otoca', false),
  ('050614', '0506', 'Saisa', false),
  ('050615', '0506', 'San Cristobal', false),
  ('050616', '0506', 'San Juan', false),
  ('050617', '0506', 'San Pedro', false),
  ('050618', '0506', 'San Pedro de Palco', false),
  ('050619', '0506', 'Sancos', false),
  ('050620', '0506', 'Santa Ana de Huaycahuacho', false),
  ('050621', '0506', 'Santa Lucia', false),
  ('050701', '0507', 'Coracora', false),
  ('050702', '0507', 'Chumpi', false),
  ('050703', '0507', 'Coronel Castañeda', false),
  ('050704', '0507', 'Pacapausa', false),
  ('050705', '0507', 'Pullo', false),
  ('050706', '0507', 'Puyusca', false),
  ('050707', '0507', 'San Francisco de Rivacayco', false),
  ('050708', '0507', 'Upahuacho', false),
  ('050801', '0508', 'Pausa', false),
  ('050802', '0508', 'Colta', false),
  ('050803', '0508', 'Corculla', false),
  ('050804', '0508', 'Lampa', false),
  ('050805', '0508', 'Marcabamba', false),
  ('050806', '0508', 'Oyolo', false),
  ('050807', '0508', 'Pararca', false),
  ('050808', '0508', 'San Javier de Alpabamba', false),
  ('050809', '0508', 'San Jose de Ushua', false),
  ('050810', '0508', 'Sara Sara', false),
  ('050901', '0509', 'Querobamba', false),
  ('050902', '0509', 'Belen', false),
  ('050903', '0509', 'Chalcos', false),
  ('050904', '0509', 'Chilcayoc', false),
  ('050905', '0509', 'Huacaña', false),
  ('050906', '0509', 'Morcolla', false),
  ('050907', '0509', 'Paico', false),
  ('050908', '0509', 'San Pedro de Larcay', false),
  ('050909', '0509', 'San Salvador de Quije', false),
  ('050910', '0509', 'Santiago de Paucaray', false),
  ('050911', '0509', 'Soras', false),
  ('051001', '0510', 'Huancapi', false),
  ('051002', '0510', 'Alcamenca', false),
  ('051003', '0510', 'Apongo', false),
  ('051004', '0510', 'Asquipata', false),
  ('051005', '0510', 'Canaria', false),
  ('051006', '0510', 'Cayara', false),
  ('051007', '0510', 'Colca', false),
  ('051008', '0510', 'Huamanquiquia', false),
  ('051009', '0510', 'Huancaraylla', false),
  ('051010', '0510', 'Hualla', false),
  ('051011', '0510', 'Sarhua', false),
  ('051012', '0510', 'Vilcanchos', false),
  ('051101', '0511', 'Vilcas Huaman', false),
  ('051102', '0511', 'Accomarca', false),
  ('051103', '0511', 'Carhuanca', false),
  ('051104', '0511', 'Concepcion', false),
  ('051105', '0511', 'Huambalpa', false),
  ('051106', '0511', 'Independencia', false),
  ('051107', '0511', 'Saurama', false),
  ('051108', '0511', 'Vischongo', false),
  ('060101', '0601', 'Cajamarca', false),
  ('060102', '0601', 'Asuncion', false),
  ('060103', '0601', 'Chetilla', false),
  ('060104', '0601', 'Cospan', false),
  ('060105', '0601', 'Encañada', false),
  ('060106', '0601', 'Jesus', false),
  ('060107', '0601', 'Llacanora', false),
  ('060108', '0601', 'Los Baños del Inca', false),
  ('060109', '0601', 'Magdalena', false),
  ('060110', '0601', 'Matara', false),
  ('060111', '0601', 'Namora', false),
  ('060112', '0601', 'San Juan', false),
  ('060201', '0602', 'Cajabamba', false),
  ('060202', '0602', 'Cachachi', false),
  ('060203', '0602', 'Condebamba', false),
  ('060204', '0602', 'Sitacocha', false),
  ('060301', '0603', 'Celendin', false),
  ('060302', '0603', 'Chumuch', false),
  ('060303', '0603', 'Cortegana', false),
  ('060304', '0603', 'Huasmin', false),
  ('060305', '0603', 'Jorge Chavez', false),
  ('060306', '0603', 'Jose Galvez', false),
  ('060307', '0603', 'Miguel Iglesias', false),
  ('060308', '0603', 'Oxamarca', false),
  ('060309', '0603', 'Sorochuco', false),
  ('060310', '0603', 'Sucre', false),
  ('060311', '0603', 'Utco', false),
  ('060312', '0603', 'La Libertad de Pallan', false),
  ('060401', '0604', 'Chota', false),
  ('060402', '0604', 'Anguia', false),
  ('060403', '0604', 'Chadin', false),
  ('060404', '0604', 'Chiguirip', false),
  ('060405', '0604', 'Chimban', false),
  ('060406', '0604', 'Choropampa', false),
  ('060407', '0604', 'Cochabamba', false),
  ('060408', '0604', 'Conchan', false),
  ('060409', '0604', 'Huambos', false),
  ('060410', '0604', 'Lajas', false),
  ('060411', '0604', 'Llama', false),
  ('060412', '0604', 'Miracosta', false),
  ('060413', '0604', 'Paccha', false),
  ('060414', '0604', 'Pion', false),
  ('060415', '0604', 'Querocoto', false),
  ('060416', '0604', 'San Juan de Licupis', false),
  ('060417', '0604', 'Tacabamba', false),
  ('060418', '0604', 'Tocmoche', false),
  ('060419', '0604', 'Chalamarca', false),
  ('060501', '0605', 'Contumaza', false),
  ('060502', '0605', 'Chilete', false),
  ('060503', '0605', 'Cupisnique', false),
  ('060504', '0605', 'Guzmango', false),
  ('060505', '0605', 'San Benito', false),
  ('060506', '0605', 'Santa Cruz de Toled', false),
  ('060507', '0605', 'Tantarica', false),
  ('060508', '0605', 'Yonan', false),
  ('060601', '0606', 'Cutervo', false),
  ('060602', '0606', 'Callayuc', false),
  ('060603', '0606', 'Choros', false),
  ('060604', '0606', 'Cujillo', false),
  ('060605', '0606', 'La Ramada', false),
  ('060606', '0606', 'Pimpingos', false),
  ('060607', '0606', 'Querocotillo', false),
  ('060608', '0606', 'San Andres de Cutervo', false),
  ('060609', '0606', 'San Juan de Cutervo', false),
  ('060610', '0606', 'San Luis de Lucma', false),
  ('060611', '0606', 'Santa Cruz', false),
  ('060612', '0606', 'Santo Domingo de la Capilla', false),
  ('060613', '0606', 'Santo Tomas', false),
  ('060614', '0606', 'Socota', false),
  ('060615', '0606', 'Toribio Casanova', false),
  ('060701', '0607', 'Bambamarca', false),
  ('060702', '0607', 'Chugur', false),
  ('060703', '0607', 'Hualgayoc', false),
  ('060801', '0608', 'Jaen', false),
  ('060802', '0608', 'Bellavista', false),
  ('060803', '0608', 'Chontali', false),
  ('060804', '0608', 'Colasay', false),
  ('060805', '0608', 'Huabal', false),
  ('060806', '0608', 'Las Pirias', false),
  ('060807', '0608', 'Pomahuaca', false),
  ('060808', '0608', 'Pucara', false),
  ('060809', '0608', 'Sallique', false),
  ('060810', '0608', 'San Felipe', false),
  ('060811', '0608', 'San Jose del Alto', false),
  ('060812', '0608', 'Santa Rosa', false),
  ('060901', '0609', 'San Ignacio', false),
  ('060902', '0609', 'Chirinos', false),
  ('060903', '0609', 'Huarango', false),
  ('060904', '0609', 'La Coipa', false),
  ('060905', '0609', 'Namballe', false),
  ('060906', '0609', 'San Jose de Lourdes', false),
  ('060907', '0609', 'Tabaconas', false),
  ('061001', '0610', 'Pedro Galvez', false),
  ('061002', '0610', 'Chancay', false),
  ('061003', '0610', 'Eduardo Villanueva', false),
  ('061004', '0610', 'Gregorio Pita', false),
  ('061005', '0610', 'Ichocan', false),
  ('061006', '0610', 'Jose Manuel Quiroz', false),
  ('061007', '0610', 'Jose Sabogal', false),
  ('061101', '0611', 'San Miguel', false),
  ('061102', '0611', 'Bolivar', false),
  ('061103', '0611', 'Calquis', false),
  ('061104', '0611', 'Catilluc', false),
  ('061105', '0611', 'El Prado', false),
  ('061106', '0611', 'La Florida', false),
  ('061107', '0611', 'Llapa', false),
  ('061108', '0611', 'Nanchoc', false),
  ('061109', '0611', 'Niepos', false),
  ('061110', '0611', 'San Gregorio', false),
  ('061111', '0611', 'San Silvestre de Cochan', false),
  ('061112', '0611', 'Tongod', false),
  ('061113', '0611', 'Union Agua Blanca', false),
  ('061201', '0612', 'San Pablo', false),
  ('061202', '0612', 'San Bernardino', false),
  ('061203', '0612', 'San Luis', false),
  ('061204', '0612', 'Tumbaden', false),
  ('061301', '0613', 'Santa Cruz', false),
  ('061302', '0613', 'Andabamba', false),
  ('061303', '0613', 'Catache', false),
  ('061304', '0613', 'Chancaybaños', false),
  ('061305', '0613', 'La Esperanza', false),
  ('061306', '0613', 'Ninabamba', false),
  ('061307', '0613', 'Pulan', false),
  ('061308', '0613', 'Saucepampa', false),
  ('061309', '0613', 'Sexi', false),
  ('061310', '0613', 'Uticyacu', false),
  ('061311', '0613', 'Yauyucan', false),
  ('070101', '0701', 'Callao', false),
  ('070102', '0701', 'Bellavista', false),
  ('070103', '0701', 'Carmen de la Legua Reynoso', false),
  ('070104', '0701', 'La Perla', false),
  ('070105', '0701', 'La Punta', false),
  ('070106', '0701', 'Ventanilla', false),
  ('070107', '0701', 'Mi Peru', false),
  ('080101', '0801', 'Cusco', false),
  ('080102', '0801', 'Ccorca', false),
  ('080103', '0801', 'Poroy', false),
  ('080104', '0801', 'San Jeronimo', false),
  ('080105', '0801', 'San Sebastian', false),
  ('080106', '0801', 'Santiago', false),
  ('080107', '0801', 'Saylla', false),
  ('080108', '0801', 'Wanchaq', false),
  ('080201', '0802', 'Acomayo', false),
  ('080202', '0802', 'Acopia', false),
  ('080203', '0802', 'Acos', false),
  ('080204', '0802', 'Mosoc Llacta', false),
  ('080205', '0802', 'Pomacanchi', false),
  ('080206', '0802', 'Rondocan', false),
  ('080207', '0802', 'Sangarara', false),
  ('080301', '0803', 'Anta', false),
  ('080302', '0803', 'Ancahuasi', false),
  ('080303', '0803', 'Cachimayo', false),
  ('080304', '0803', 'Chinchaypujio', false),
  ('080305', '0803', 'Huarocondo', false),
  ('080306', '0803', 'Limatambo', false),
  ('080307', '0803', 'Mollepata', false),
  ('080308', '0803', 'Pucyura', false),
  ('080309', '0803', 'Zurite', false),
  ('080401', '0804', 'Calca', false),
  ('080402', '0804', 'Coya', false),
  ('080403', '0804', 'Lamay', false),
  ('080404', '0804', 'Lares', false),
  ('080405', '0804', 'Pisac', false),
  ('080406', '0804', 'San Salvador', false),
  ('080407', '0804', 'Taray', false),
  ('080408', '0804', 'Yanatile', false),
  ('080501', '0805', 'Yanaoca', false),
  ('080502', '0805', 'Checca', false),
  ('080503', '0805', 'Kunturkanki', false),
  ('080504', '0805', 'Langui', false),
  ('080505', '0805', 'Layo', false),
  ('080506', '0805', 'Pampamarca', false),
  ('080507', '0805', 'Quehue', false),
  ('080508', '0805', 'Tupac Amaru', false),
  ('080601', '0806', 'Sicuani', false),
  ('080602', '0806', 'Checacupe', false),
  ('080603', '0806', 'Combapata', false),
  ('080604', '0806', 'Marangani', false),
  ('080605', '0806', 'Pitumarca', false),
  ('080606', '0806', 'San Pablo', false),
  ('080607', '0806', 'San Pedro', false),
  ('080608', '0806', 'Tinta', false),
  ('080701', '0807', 'Santo Tomas', false),
  ('080702', '0807', 'Capacmarca', false),
  ('080703', '0807', 'Chamaca', false),
  ('080704', '0807', 'Colquemarca', false),
  ('080705', '0807', 'Livitaca', false),
  ('080706', '0807', 'Llusco', false),
  ('080707', '0807', 'Quiñota', false),
  ('080708', '0807', 'Velille', false),
  ('080801', '0808', 'Espinar', false),
  ('080802', '0808', 'Condoroma', false),
  ('080803', '0808', 'Coporaque', false),
  ('080804', '0808', 'Ocoruro', false),
  ('080805', '0808', 'Pallpata', false),
  ('080806', '0808', 'Pichigua', false),
  ('080807', '0808', 'Suyckutambo', false),
  ('080808', '0808', 'Alto Pichigua', false),
  ('080901', '0809', 'Santa Ana', false),
  ('080902', '0809', 'Echarate', false),
  ('080903', '0809', 'Huayopata', false),
  ('080904', '0809', 'Maranura', false),
  ('080905', '0809', 'Ocobamba', false),
  ('080906', '0809', 'Quellouno', false),
  ('080907', '0809', 'Kimbiri', false),
  ('080908', '0809', 'Santa Teresa', false),
  ('080909', '0809', 'Vilcabamba', false),
  ('080910', '0809', 'Pichari', false),
  ('080911', '0809', 'Inkawasi', false),
  ('080912', '0809', 'Villa Virgen', false),
  ('080913', '0809', 'Villa Kintiarina', false),
  ('080914', '0809', 'Megantoni', false),
  ('080915', '0809', 'Kumpirushiato', false),
  ('080916', '0809', 'Cielo Punco', false),
  ('080917', '0809', 'Manitea', false),
  ('080918', '0809', 'Union Ashaninka', false),
  ('081001', '0810', 'Paruro', false),
  ('081002', '0810', 'Accha', false),
  ('081003', '0810', 'Ccapi', false),
  ('081004', '0810', 'Colcha', false),
  ('081005', '0810', 'Huanoquite', false),
  ('081006', '0810', 'Omacha', false),
  ('081007', '0810', 'Paccaritambo', false),
  ('081008', '0810', 'Pillpinto', false),
  ('081009', '0810', 'Yaurisque', false),
  ('081101', '0811', 'Paucartambo', false),
  ('081102', '0811', 'Caicay', false),
  ('081103', '0811', 'Challabamba', false),
  ('081104', '0811', 'Colquepata', false),
  ('081105', '0811', 'Huancarani', false),
  ('081106', '0811', 'Kosñipata', false),
  ('081201', '0812', 'Urcos', false),
  ('081202', '0812', 'Andahuaylillas', false),
  ('081203', '0812', 'Camanti', false),
  ('081204', '0812', 'Ccarhuayo', false),
  ('081205', '0812', 'Ccatca', false),
  ('081206', '0812', 'Cusipata', false),
  ('081207', '0812', 'Huaro', false),
  ('081208', '0812', 'Lucre', false),
  ('081209', '0812', 'Marcapata', false),
  ('081210', '0812', 'Ocongate', false),
  ('081211', '0812', 'Oropesa', false),
  ('081212', '0812', 'Quiquijana', false),
  ('081301', '0813', 'Urubamba', false),
  ('081302', '0813', 'Chinchero', false),
  ('081303', '0813', 'Huayllabamba', false),
  ('081304', '0813', 'Machupicchu', false),
  ('081305', '0813', 'Maras', false),
  ('081306', '0813', 'Ollantaytambo', false),
  ('081307', '0813', 'Yucay', false),
  ('090101', '0901', 'Huancavelica', false),
  ('090102', '0901', 'Acobambilla', false),
  ('090103', '0901', 'Acoria', false),
  ('090104', '0901', 'Conayca', false),
  ('090105', '0901', 'Cuenca', false),
  ('090106', '0901', 'Huachocolpa', false),
  ('090107', '0901', 'Huayllahuara', false),
  ('090108', '0901', 'Izcuchaca', false),
  ('090109', '0901', 'Laria', false),
  ('090110', '0901', 'Manta', false),
  ('090111', '0901', 'Mariscal Caceres', false),
  ('090112', '0901', 'Moya', false),
  ('090113', '0901', 'Nuevo Occoro', false),
  ('090114', '0901', 'Palca', false),
  ('090115', '0901', 'Pilchaca', false),
  ('090116', '0901', 'Vilca', false),
  ('090117', '0901', 'Yauli', false),
  ('090118', '0901', 'Ascension', false),
  ('090119', '0901', 'Huando', false),
  ('090201', '0902', 'Acobamba', false),
  ('090202', '0902', 'Andabamba', false),
  ('090203', '0902', 'Anta', false),
  ('090204', '0902', 'Caja', false),
  ('090205', '0902', 'Marcas', false),
  ('090206', '0902', 'Paucara', false),
  ('090207', '0902', 'Pomacocha', false),
  ('090208', '0902', 'Rosario', false),
  ('090301', '0903', 'Lircay', false),
  ('090302', '0903', 'Anchonga', false),
  ('090303', '0903', 'Callanmarca', false),
  ('090304', '0903', 'Ccochaccasa', false),
  ('090305', '0903', 'Chincho', false),
  ('090306', '0903', 'Congalla', false),
  ('090307', '0903', 'Huanca-Huanca', false),
  ('090308', '0903', 'Huayllay Grande', false),
  ('090309', '0903', 'Julcamarca', false),
  ('090310', '0903', 'San Antonio de Antaparco', false),
  ('090311', '0903', 'Santo Tomas de Pata', false),
  ('090312', '0903', 'Secclla', false),
  ('090401', '0904', 'Castrovirreyna', false),
  ('090402', '0904', 'Arma', false),
  ('090403', '0904', 'Aurahua', false),
  ('090404', '0904', 'Capillas', false),
  ('090405', '0904', 'Chupamarca', false),
  ('090406', '0904', 'Cocas', false),
  ('090407', '0904', 'Huachos', false),
  ('090408', '0904', 'Huamatambo', false),
  ('090409', '0904', 'Mollepampa', false),
  ('090410', '0904', 'San Juan', false),
  ('090411', '0904', 'Santa Ana', false),
  ('090412', '0904', 'Tantara', false),
  ('090413', '0904', 'Ticrapo', false),
  ('090501', '0905', 'Churcampa', false),
  ('090502', '0905', 'Anco', false),
  ('090503', '0905', 'Chinchihuasi', false),
  ('090504', '0905', 'El Carmen', false),
  ('090505', '0905', 'La Merced', false),
  ('090506', '0905', 'Locroja', false),
  ('090507', '0905', 'Paucarbamba', false),
  ('090508', '0905', 'San Miguel de Mayocc', false),
  ('090509', '0905', 'San Pedro de Coris', false),
  ('090510', '0905', 'Pachamarca', false),
  ('090511', '0905', 'Cosme', false),
  ('090601', '0906', 'Huaytara', false),
  ('090602', '0906', 'Ayavi', false),
  ('090603', '0906', 'Cordova', false),
  ('090604', '0906', 'Huayacundo Arma', false),
  ('090605', '0906', 'Laramarca', false),
  ('090606', '0906', 'Ocoyo', false),
  ('090607', '0906', 'Pilpichaca', false),
  ('090608', '0906', 'Querco', false),
  ('090609', '0906', 'Quito-Arma', false),
  ('090610', '0906', 'San Antonio de Cusicancha', false),
  ('090611', '0906', 'San Francisco de Sangayaico', false),
  ('090612', '0906', 'San Isidro', false),
  ('090613', '0906', 'Santiago de Chocorvos', false),
  ('090614', '0906', 'Santiago de Quirahuara', false),
  ('090615', '0906', 'Santo Domingo de Capillas', false),
  ('090616', '0906', 'Tambo', false),
  ('090701', '0907', 'Pampas', false),
  ('090702', '0907', 'Acostambo', false),
  ('090703', '0907', 'Acraquia', false),
  ('090704', '0907', 'Ahuaycha', false),
  ('090705', '0907', 'Colcabamba', false),
  ('090706', '0907', 'Daniel Hernandez', false),
  ('090707', '0907', 'Huachocolpa', false),
  ('090709', '0907', 'Huaribamba', false),
  ('090710', '0907', 'Ñahuimpuquio', false),
  ('090711', '0907', 'Pazos', false),
  ('090713', '0907', 'Quishuar', false),
  ('090714', '0907', 'Salcabamba', false),
  ('090715', '0907', 'Salcahuasi', false),
  ('090716', '0907', 'San Marcos de Rocchac', false),
  ('090717', '0907', 'Surcubamba', false),
  ('090718', '0907', 'Tintay Puncu', false),
  ('090719', '0907', 'Quichuas', false),
  ('090720', '0907', 'Andaymarca', false),
  ('090721', '0907', 'Roble', false),
  ('090722', '0907', 'Pichos', false),
  ('090723', '0907', 'Santiago de Tucuma', false),
  ('090724', '0907', 'Lambras', false),
  ('090725', '0907', 'Cochabamba', false),
  ('100101', '1001', 'Huanuco', false),
  ('100102', '1001', 'Amarilis', false),
  ('100103', '1001', 'Chinchao', false),
  ('100104', '1001', 'Churubamba', false),
  ('100105', '1001', 'Margos', false),
  ('100106', '1001', 'Quisqui (kichki)', false),
  ('100107', '1001', 'San Francisco de Cayran', false),
  ('100108', '1001', 'San Pedro de Chaulan', false),
  ('100109', '1001', 'Santa Maria del Valle', false),
  ('100110', '1001', 'Yarumayo', false),
  ('100111', '1001', 'Pillco Marca', false),
  ('100112', '1001', 'Yacus', false),
  ('100113', '1001', 'San Pablo de Pillao', false),
  ('100201', '1002', 'Ambo', false),
  ('100202', '1002', 'Cayna', false),
  ('100203', '1002', 'Colpas', false),
  ('100204', '1002', 'Conchamarca', false),
  ('100205', '1002', 'Huacar', false),
  ('100206', '1002', 'San Francisco', false),
  ('100207', '1002', 'San Rafael', false),
  ('100208', '1002', 'Tomay Kichwa', false),
  ('100301', '1003', 'La Union', false),
  ('100307', '1003', 'Chuquis', false),
  ('100311', '1003', 'Marias', false),
  ('100313', '1003', 'Pachas', false),
  ('100316', '1003', 'Quivilla', false),
  ('100317', '1003', 'Ripan', false),
  ('100321', '1003', 'Shunqui', false),
  ('100322', '1003', 'Sillapata', false),
  ('100323', '1003', 'Yanas', false),
  ('100401', '1004', 'Huacaybamba', false),
  ('100402', '1004', 'Canchabamba', false),
  ('100403', '1004', 'Cochabamba', false),
  ('100404', '1004', 'Pinra', false),
  ('100501', '1005', 'Llata', false),
  ('100502', '1005', 'Arancay', false),
  ('100503', '1005', 'Chavin de Pariarca', false),
  ('100504', '1005', 'Jacas Grande', false),
  ('100505', '1005', 'Jircan', false),
  ('100506', '1005', 'Miraflores', false),
  ('100507', '1005', 'Monzon', false),
  ('100508', '1005', 'Punchao', false),
  ('100509', '1005', 'Puños', false),
  ('100510', '1005', 'Singa', false),
  ('100511', '1005', 'Tantamayo', false),
  ('100601', '1006', 'Rupa-Rupa', false),
  ('100602', '1006', 'Daniel Alomia Robles', false),
  ('100603', '1006', 'Hermilio Valdizan', false),
  ('100604', '1006', 'Jose Crespo y Castillo', false),
  ('100605', '1006', 'Luyando', false),
  ('100606', '1006', 'Mariano Damaso Beraun', false),
  ('100607', '1006', 'Pucayacu', false),
  ('100608', '1006', 'Castillo Grande', false),
  ('100609', '1006', 'Pueblo Nuevo', false),
  ('100610', '1006', 'Santo Domingo de Anda', false),
  ('100701', '1007', 'Huacrachuco', false),
  ('100702', '1007', 'Cholon', false),
  ('100703', '1007', 'San Buenaventura', false),
  ('100704', '1007', 'La Morada', false),
  ('100705', '1007', 'Santa Rosa de Alto Yanajanca', false),
  ('100801', '1008', 'Panao', false),
  ('100802', '1008', 'Chaglla', false),
  ('100803', '1008', 'Molino', false),
  ('100804', '1008', 'Umari', false),
  ('100901', '1009', 'Puerto Inca', false),
  ('100902', '1009', 'Codo del Pozuzo', false),
  ('100903', '1009', 'Honoria', false),
  ('100904', '1009', 'Tournavista', false),
  ('100905', '1009', 'Yuyapichis', false),
  ('101001', '1010', 'Jesus', false),
  ('101002', '1010', 'Baños', false),
  ('101003', '1010', 'Jivia', false),
  ('101004', '1010', 'Queropalca', false),
  ('101005', '1010', 'Rondos', false),
  ('101006', '1010', 'San Francisco de Asis', false),
  ('101007', '1010', 'San Miguel de Cauri', false),
  ('101101', '1011', 'Chavinillo', false),
  ('101102', '1011', 'Cahuac', false),
  ('101103', '1011', 'Chacabamba', false),
  ('101104', '1011', 'Aparicio Pomares', false),
  ('101105', '1011', 'Jacas Chico', false),
  ('101106', '1011', 'Obas', false),
  ('101107', '1011', 'Pampamarca', false),
  ('101108', '1011', 'Choras', false),
  ('110101', '1101', 'Ica', false),
  ('110102', '1101', 'La Tinguiña', false),
  ('110103', '1101', 'Los Aquijes', false),
  ('110104', '1101', 'Ocucaje', false),
  ('110105', '1101', 'Pachacutec', false),
  ('110106', '1101', 'Parcona', false),
  ('110107', '1101', 'Pueblo Nuevo', false),
  ('110108', '1101', 'Salas', false),
  ('110109', '1101', 'San Jose de los Molinos', false),
  ('110110', '1101', 'San Juan Bautista', false),
  ('110111', '1101', 'Santiago', false),
  ('110112', '1101', 'Subtanjalla', false),
  ('110113', '1101', 'Tate', false),
  ('110114', '1101', 'Yauca del Rosario', false),
  ('110201', '1102', 'Chincha Alta', false),
  ('110202', '1102', 'Alto Laran', false),
  ('110203', '1102', 'Chavin', false),
  ('110204', '1102', 'Chincha Baja', false),
  ('110205', '1102', 'El Carmen', false),
  ('110206', '1102', 'Grocio Prado', false),
  ('110207', '1102', 'Pueblo Nuevo', false),
  ('110208', '1102', 'San Juan de Yanac', false),
  ('110209', '1102', 'San Pedro de Huacarpana', false),
  ('110210', '1102', 'Sunampe', false),
  ('110211', '1102', 'Tambo de Mora', false),
  ('110301', '1103', 'Nasca', false),
  ('110302', '1103', 'Changuillo', false),
  ('110303', '1103', 'El Ingenio', false),
  ('110304', '1103', 'Marcona', false),
  ('110305', '1103', 'Vista Alegre', false),
  ('110401', '1104', 'Palpa', false),
  ('110402', '1104', 'Llipata', false),
  ('110403', '1104', 'Rio Grande', false),
  ('110404', '1104', 'Santa Cruz', false),
  ('110405', '1104', 'Tibillo', false),
  ('110501', '1105', 'Pisco', false),
  ('110502', '1105', 'Huancano', false),
  ('110503', '1105', 'Humay', false),
  ('110504', '1105', 'Independencia', false),
  ('110505', '1105', 'Paracas', false),
  ('110506', '1105', 'San Andres', false),
  ('110507', '1105', 'San Clemente', false),
  ('110508', '1105', 'Tupac Amaru Inca', false),
  ('120101', '1201', 'Huancayo', false),
  ('120104', '1201', 'Carhuacallanga', false),
  ('120105', '1201', 'Chacapampa', false),
  ('120106', '1201', 'Chicche', false),
  ('120107', '1201', 'Chilca', false),
  ('120108', '1201', 'Chongos Alto', false),
  ('120111', '1201', 'Chupuro', false),
  ('120112', '1201', 'Colca', false),
  ('120113', '1201', 'Cullhuas', false),
  ('120114', '1201', 'El Tambo', false),
  ('120116', '1201', 'Huacrapuquio', false),
  ('120117', '1201', 'Hualhuas', false),
  ('120119', '1201', 'Huancan', false),
  ('120120', '1201', 'Huasicancha', false),
  ('120121', '1201', 'Huayucachi', false),
  ('120122', '1201', 'Ingenio', false),
  ('120124', '1201', 'Pariahuanca', false),
  ('120125', '1201', 'Pilcomayo', false),
  ('120126', '1201', 'Pucara', false),
  ('120127', '1201', 'Quichuay', false),
  ('120128', '1201', 'Quilcas', false),
  ('120129', '1201', 'San Agustin', false),
  ('120130', '1201', 'San Jeronimo de Tunan', false),
  ('120132', '1201', 'Saño', false),
  ('120133', '1201', 'Sapallanga', false),
  ('120134', '1201', 'Sicaya', false),
  ('120135', '1201', 'Santo Domingo de Acobamba', false),
  ('120136', '1201', 'Viques', false),
  ('120201', '1202', 'Concepcion', false),
  ('120202', '1202', 'Aco', false),
  ('120203', '1202', 'Andamarca', false),
  ('120204', '1202', 'Chambara', false),
  ('120205', '1202', 'Cochas', false),
  ('120206', '1202', 'Comas', false),
  ('120207', '1202', 'Heroinas Toledo', false),
  ('120208', '1202', 'Manzanares', false),
  ('120209', '1202', 'Mariscal Castilla', false),
  ('120210', '1202', 'Matahuasi', false),
  ('120211', '1202', 'Mito', false),
  ('120212', '1202', 'Nueve de Julio', false),
  ('120213', '1202', 'Orcotuna', false),
  ('120214', '1202', 'San Jose de Quero', false),
  ('120215', '1202', 'Santa Rosa de Ocopa', false),
  ('120301', '1203', 'Chanchamayo', false),
  ('120302', '1203', 'Perene', false),
  ('120303', '1203', 'Pichanaqui', false),
  ('120304', '1203', 'San Luis de Shuaro', false),
  ('120305', '1203', 'San Ramon', false),
  ('120306', '1203', 'Vitoc', false),
  ('120307', '1203', 'Sangani', true),
  ('120401', '1204', 'Jauja', false),
  ('120402', '1204', 'Acolla', false),
  ('120403', '1204', 'Apata', false),
  ('120404', '1204', 'Ataura', false),
  ('120405', '1204', 'Canchayllo', false),
  ('120406', '1204', 'Curicaca', false),
  ('120407', '1204', 'El Mantaro', false),
  ('120408', '1204', 'Huamali', false),
  ('120409', '1204', 'Huaripampa', false),
  ('120410', '1204', 'Huertas', false),
  ('120411', '1204', 'Janjaillo', false),
  ('120412', '1204', 'Julcan', false),
  ('120413', '1204', 'Leonor Ordoñez', false),
  ('120414', '1204', 'Llocllapampa', false),
  ('120415', '1204', 'Marco', false),
  ('120416', '1204', 'Masma', false),
  ('120417', '1204', 'Masma Chicche', false),
  ('120418', '1204', 'Molinos', false),
  ('120419', '1204', 'Monobamba', false),
  ('120420', '1204', 'Muqui', false),
  ('120421', '1204', 'Muquiyauyo', false),
  ('120422', '1204', 'Paca', false),
  ('120423', '1204', 'Paccha', false),
  ('120424', '1204', 'Pancan', false),
  ('120425', '1204', 'Parco', false),
  ('120426', '1204', 'Pomacancha', false),
  ('120427', '1204', 'Ricran', false),
  ('120428', '1204', 'San Lorenzo', false),
  ('120429', '1204', 'San Pedro de Chunan', false),
  ('120430', '1204', 'Sausa', false),
  ('120431', '1204', 'Sincos', false),
  ('120432', '1204', 'Tunan Marca', false),
  ('120433', '1204', 'Yauli', false),
  ('120434', '1204', 'Yauyos', false),
  ('120501', '1205', 'Junin', false),
  ('120502', '1205', 'Carhuamayo', false),
  ('120503', '1205', 'Ondores', false),
  ('120504', '1205', 'Ulcumayo', false),
  ('120601', '1206', 'Satipo', false),
  ('120602', '1206', 'Coviriali', false),
  ('120603', '1206', 'Llaylla', false),
  ('120604', '1206', 'Mazamari', false),
  ('120605', '1206', 'Pampa Hermosa', false),
  ('120606', '1206', 'Pangoa', false),
  ('120607', '1206', 'Rio Negro', false),
  ('120608', '1206', 'Rio Tambo', false),
  ('120609', '1206', 'Vizcatán del Ene', false),
  ('120701', '1207', 'Tarma', false),
  ('120702', '1207', 'Acobamba', false),
  ('120703', '1207', 'Huaricolca', false),
  ('120704', '1207', 'Huasahuasi', false),
  ('120705', '1207', 'La Union', false),
  ('120706', '1207', 'Palca', false),
  ('120707', '1207', 'Palcamayo', false),
  ('120708', '1207', 'San Pedro de Cajas', false),
  ('120709', '1207', 'Tapo', false),
  ('120801', '1208', 'La Oroya', false),
  ('120802', '1208', 'Chacapalpa', false),
  ('120803', '1208', 'Huay-Huay', false),
  ('120804', '1208', 'Marcapomacocha', false),
  ('120805', '1208', 'Morococha', false),
  ('120806', '1208', 'Paccha', false),
  ('120807', '1208', 'Santa Barbara de Carhuacayan', false),
  ('120808', '1208', 'Santa Rosa de Sacco', false),
  ('120809', '1208', 'Suitucancha', false),
  ('120810', '1208', 'Yauli', false),
  ('120901', '1209', 'Chupaca', false),
  ('120902', '1209', 'Ahuac', false),
  ('120903', '1209', 'Chongos Bajo', false),
  ('120904', '1209', 'Huachac', false),
  ('120905', '1209', 'Huamancaca Chico', false),
  ('120906', '1209', 'San Juan de Iscos', false),
  ('120907', '1209', 'San Juan de Jarpa', false),
  ('120908', '1209', 'Tres de Diciembre', false),
  ('120909', '1209', 'Yanacancha', false),
  ('130101', '1301', 'Trujillo', false),
  ('130102', '1301', 'El Porvenir', false),
  ('130103', '1301', 'Florencia de Mora', false),
  ('130104', '1301', 'Huanchaco', false),
  ('130105', '1301', 'La Esperanza', false),
  ('130106', '1301', 'Laredo', false),
  ('130107', '1301', 'Moche', false),
  ('130108', '1301', 'Poroto', false),
  ('130109', '1301', 'Salaverry', false),
  ('130110', '1301', 'Simbal', false),
  ('130111', '1301', 'Victor Larco Herrera', false),
  ('130112', '1301', 'Alto Trujillo', false),
  ('130201', '1302', 'Ascope', false),
  ('130202', '1302', 'Chicama', false),
  ('130203', '1302', 'Chocope', false),
  ('130204', '1302', 'Magdalena de Cao', false),
  ('130205', '1302', 'Paijan', false),
  ('130206', '1302', 'Razuri', false),
  ('130207', '1302', 'Santiago de Cao', false),
  ('130208', '1302', 'Casa Grande', false),
  ('130301', '1303', 'Bolivar', false),
  ('130302', '1303', 'Bambamarca', false),
  ('130303', '1303', 'Condormarca', false),
  ('130304', '1303', 'Longotea', false),
  ('130305', '1303', 'Uchumarca', false),
  ('130306', '1303', 'Ucuncha', false),
  ('130401', '1304', 'Chepen', false),
  ('130402', '1304', 'Pacanga', false),
  ('130403', '1304', 'Pueblo Nuevo', false),
  ('130501', '1305', 'Julcan', false),
  ('130502', '1305', 'Calamarca', false),
  ('130503', '1305', 'Carabamba', false),
  ('130504', '1305', 'Huaso', false),
  ('130601', '1306', 'Otuzco', false),
  ('130602', '1306', 'Agallpampa', false),
  ('130604', '1306', 'Charat', false),
  ('130605', '1306', 'Huaranchal', false),
  ('130606', '1306', 'La Cuesta', false),
  ('130608', '1306', 'Mache', false),
  ('130610', '1306', 'Paranday', false),
  ('130611', '1306', 'Salpo', false),
  ('130613', '1306', 'Sinsicap', false),
  ('130614', '1306', 'Usquil', false),
  ('130701', '1307', 'San Pedro de Lloc', false),
  ('130702', '1307', 'Guadalupe', false),
  ('130703', '1307', 'Jequetepeque', false),
  ('130704', '1307', 'Pacasmayo', false),
  ('130705', '1307', 'San Jose', false),
  ('130801', '1308', 'Tayabamba', false),
  ('130802', '1308', 'Buldibuyo', false),
  ('130803', '1308', 'Chillia', false),
  ('130804', '1308', 'Huancaspata', false),
  ('130805', '1308', 'Huaylillas', false),
  ('130806', '1308', 'Huayo', false),
  ('130807', '1308', 'Ongon', false),
  ('130808', '1308', 'Parcoy', false),
  ('130809', '1308', 'Pataz', false),
  ('130810', '1308', 'Pias', false),
  ('130811', '1308', 'Santiago de Challas', false),
  ('130812', '1308', 'Taurija', false),
  ('130813', '1308', 'Urpay', false),
  ('130901', '1309', 'Huamachuco', false),
  ('130902', '1309', 'Chugay', false),
  ('130903', '1309', 'Cochorco', false),
  ('130904', '1309', 'Curgos', false),
  ('130905', '1309', 'Marcabal', false),
  ('130906', '1309', 'Sanagoran', false),
  ('130907', '1309', 'Sarin', false),
  ('130908', '1309', 'Sartimbamba', false),
  ('131001', '1310', 'Santiago de Chuco', false),
  ('131002', '1310', 'Angasmarca', false),
  ('131003', '1310', 'Cachicadan', false),
  ('131004', '1310', 'Mollebamba', false),
  ('131005', '1310', 'Mollepata', false),
  ('131006', '1310', 'Quiruvilca', false),
  ('131007', '1310', 'Santa Cruz de Chuca', false),
  ('131008', '1310', 'Sitabamba', false),
  ('131101', '1311', 'Cascas', false),
  ('131102', '1311', 'Lucma', false),
  ('131103', '1311', 'Marmot', false),
  ('131104', '1311', 'Sayapullo', false),
  ('131201', '1312', 'Viru', false),
  ('131202', '1312', 'Chao', false),
  ('131203', '1312', 'Guadalupito', false),
  ('140101', '1401', 'Chiclayo', false),
  ('140102', '1401', 'Chongoyape', false),
  ('140103', '1401', 'Eten', false),
  ('140104', '1401', 'Eten Puerto', false),
  ('140105', '1401', 'Jose Leonardo Ortiz', false),
  ('140106', '1401', 'La Victoria', false),
  ('140107', '1401', 'Lagunas', false),
  ('140108', '1401', 'Monsefu', false),
  ('140109', '1401', 'Nueva Arica', false),
  ('140110', '1401', 'Oyotun', false),
  ('140111', '1401', 'Picsi', false),
  ('140112', '1401', 'Pimentel', false),
  ('140113', '1401', 'Reque', false),
  ('140114', '1401', 'Santa Rosa', false),
  ('140115', '1401', 'Saña', false),
  ('140116', '1401', 'Cayalti', false),
  ('140117', '1401', 'Patapo', false),
  ('140118', '1401', 'Pomalca', false),
  ('140119', '1401', 'Pucala', false),
  ('140120', '1401', 'Tuman', false),
  ('140201', '1402', 'Ferreñafe', false),
  ('140202', '1402', 'Cañaris', false),
  ('140203', '1402', 'Incahuasi', false),
  ('140204', '1402', 'Manuel Antonio Mesones Muro', false),
  ('140205', '1402', 'Pitipo', false),
  ('140206', '1402', 'Pueblo Nuevo', false),
  ('140301', '1403', 'Lambayeque', false),
  ('140302', '1403', 'Chochope', false),
  ('140303', '1403', 'Illimo', false),
  ('140304', '1403', 'Jayanca', false),
  ('140305', '1403', 'Mochumi', false),
  ('140306', '1403', 'Morrope', false),
  ('140307', '1403', 'Motupe', false),
  ('140308', '1403', 'Olmos', false),
  ('140309', '1403', 'Pacora', false),
  ('140310', '1403', 'Salas', false),
  ('140311', '1403', 'San Jose', false),
  ('140312', '1403', 'Tucume', false),
  ('150101', '1501', 'Lima', false),
  ('150102', '1501', 'Ancon', false),
  ('150103', '1501', 'Ate', false),
  ('150104', '1501', 'Barranco', false),
  ('150105', '1501', 'Breña', false),
  ('150106', '1501', 'Carabayllo', false),
  ('150107', '1501', 'Chaclacayo', false),
  ('150108', '1501', 'Chorrillos', false),
  ('150109', '1501', 'Cieneguilla', false),
  ('150110', '1501', 'Comas', false),
  ('150111', '1501', 'El Agustino', false),
  ('150112', '1501', 'Independencia', false),
  ('150113', '1501', 'Jesus Maria', false),
  ('150114', '1501', 'La Molina', false),
  ('150115', '1501', 'La Victoria', false),
  ('150116', '1501', 'Lince', false),
  ('150117', '1501', 'Los Olivos', false),
  ('150118', '1501', 'Lurigancho', false),
  ('150119', '1501', 'Lurin', false),
  ('150120', '1501', 'Magdalena del Mar', false),
  ('150121', '1501', 'Pueblo Libre', false),
  ('150122', '1501', 'Miraflores', false),
  ('150123', '1501', 'Pachacamac', false),
  ('150124', '1501', 'Pucusana', false),
  ('150125', '1501', 'Puente Piedra', false),
  ('150126', '1501', 'Punta Hermosa', false),
  ('150127', '1501', 'Punta Negra', false),
  ('150128', '1501', 'Rimac', false),
  ('150129', '1501', 'San Bartolo', false),
  ('150130', '1501', 'San Borja', false),
  ('150131', '1501', 'San Isidro', false),
  ('150132', '1501', 'San Juan de Lurigancho', false),
  ('150133', '1501', 'San Juan de Miraflores', false),
  ('150134', '1501', 'San Luis', false),
  ('150135', '1501', 'San Martin de Porres', false),
  ('150136', '1501', 'San Miguel', false),
  ('150137', '1501', 'Santa Anita', false),
  ('150138', '1501', 'Santa Maria del Mar', false),
  ('150139', '1501', 'Santa Rosa', false),
  ('150140', '1501', 'Santiago de Surco', false),
  ('150141', '1501', 'Surquillo', false),
  ('150142', '1501', 'Villa el Salvador', false),
  ('150143', '1501', 'Villa Maria del Triunfo', false),
  ('150201', '1502', 'Barranca', false),
  ('150202', '1502', 'Paramonga', false),
  ('150203', '1502', 'Pativilca', false),
  ('150204', '1502', 'Supe', false),
  ('150205', '1502', 'Supe Puerto', false),
  ('150301', '1503', 'Cajatambo', false),
  ('150302', '1503', 'Copa', false),
  ('150303', '1503', 'Gorgor', false),
  ('150304', '1503', 'Huancapon', false),
  ('150305', '1503', 'Manas', false),
  ('150401', '1504', 'Canta', false),
  ('150402', '1504', 'Arahuay', false),
  ('150403', '1504', 'Huamantanga', false),
  ('150404', '1504', 'Huaros', false),
  ('150405', '1504', 'Lachaqui', false),
  ('150406', '1504', 'San Buenaventura', false),
  ('150407', '1504', 'Santa Rosa de Quives', false),
  ('150501', '1505', 'San Vicente de Cañete', false),
  ('150502', '1505', 'Asia', false),
  ('150503', '1505', 'Calango', false),
  ('150504', '1505', 'Cerro Azul', false),
  ('150505', '1505', 'Chilca', false),
  ('150506', '1505', 'Coayllo', false),
  ('150507', '1505', 'Imperial', false),
  ('150508', '1505', 'Lunahuana', false),
  ('150509', '1505', 'Mala', false),
  ('150510', '1505', 'Nuevo Imperial', false),
  ('150511', '1505', 'Pacaran', false),
  ('150512', '1505', 'Quilmana', false),
  ('150513', '1505', 'San Antonio', false),
  ('150514', '1505', 'San Luis', false),
  ('150515', '1505', 'Santa Cruz de Flores', false),
  ('150516', '1505', 'Zuñiga', false),
  ('150601', '1506', 'Huaral', false),
  ('150602', '1506', 'Atavillos Alto', false),
  ('150603', '1506', 'Atavillos Bajo', false),
  ('150604', '1506', 'Aucallama', false),
  ('150605', '1506', 'Chancay', false),
  ('150606', '1506', 'Ihuari', false),
  ('150607', '1506', 'Lampian', false),
  ('150608', '1506', 'Pacaraos', false),
  ('150609', '1506', 'San Miguel de Acos', false),
  ('150610', '1506', 'Santa Cruz de Andamarca', false),
  ('150611', '1506', 'Sumbilca', false),
  ('150612', '1506', 'Veintisiete de Noviembre', false),
  ('150701', '1507', 'Matucana', false),
  ('150702', '1507', 'Antioquia', false),
  ('150703', '1507', 'Callahuanca', false),
  ('150704', '1507', 'Carampoma', false),
  ('150705', '1507', 'Chicla', false),
  ('150706', '1507', 'Cuenca', false),
  ('150707', '1507', 'Huachupampa', false),
  ('150708', '1507', 'Huanza', false),
  ('150709', '1507', 'Huarochiri', false),
  ('150710', '1507', 'Lahuaytambo', false),
  ('150711', '1507', 'Langa', false),
  ('150712', '1507', 'San Pedro de Laraos', false),
  ('150713', '1507', 'Mariatana', false),
  ('150714', '1507', 'Ricardo Palma', false),
  ('150715', '1507', 'San Andres de Tupicocha', false),
  ('150716', '1507', 'San Antonio', false),
  ('150717', '1507', 'San Bartolome', false),
  ('150718', '1507', 'San Damian', false),
  ('150719', '1507', 'San Juan de Iris', false),
  ('150720', '1507', 'San Juan de Tantaranche', false),
  ('150721', '1507', 'San Lorenzo de Quinti', false),
  ('150722', '1507', 'San Mateo', false),
  ('150723', '1507', 'San Mateo de Otao', false),
  ('150724', '1507', 'San Pedro de Casta', false),
  ('150725', '1507', 'San Pedro de Huancayre', false),
  ('150726', '1507', 'Sangallaya', false),
  ('150727', '1507', 'Santa Cruz de Cocachacra', false),
  ('150728', '1507', 'Santa Eulalia', false),
  ('150729', '1507', 'Santiago de Anchucaya', false),
  ('150730', '1507', 'Santiago de Tuna', false),
  ('150731', '1507', 'Santo Domingo de los Olleros', false),
  ('150732', '1507', 'Surco', false),
  ('150801', '1508', 'Huacho', false),
  ('150802', '1508', 'Ambar', false),
  ('150803', '1508', 'Caleta de Carquin', false),
  ('150804', '1508', 'Checras', false),
  ('150805', '1508', 'Hualmay', false),
  ('150806', '1508', 'Huaura', false),
  ('150807', '1508', 'Leoncio Prado', false),
  ('150808', '1508', 'Paccho', false),
  ('150809', '1508', 'Santa Leonor', false),
  ('150810', '1508', 'Santa Maria', false),
  ('150811', '1508', 'Sayan', false),
  ('150812', '1508', 'Vegueta', false),
  ('150901', '1509', 'Oyon', false),
  ('150902', '1509', 'Andajes', false),
  ('150903', '1509', 'Caujul', false),
  ('150904', '1509', 'Cochamarca', false),
  ('150905', '1509', 'Navan', false),
  ('150906', '1509', 'Pachangara', false),
  ('151001', '1510', 'Yauyos', false),
  ('151002', '1510', 'Alis', false),
  ('151003', '1510', 'Allauca', false),
  ('151004', '1510', 'Ayaviri', false),
  ('151005', '1510', 'Azangaro', false),
  ('151006', '1510', 'Cacra', false),
  ('151007', '1510', 'Carania', false),
  ('151008', '1510', 'Catahuasi', false),
  ('151009', '1510', 'Chocos', false),
  ('151010', '1510', 'Cochas', false),
  ('151011', '1510', 'Colonia', false),
  ('151012', '1510', 'Hongos', false),
  ('151013', '1510', 'Huampara', false),
  ('151014', '1510', 'Huancaya', false),
  ('151015', '1510', 'Huangascar', false),
  ('151016', '1510', 'Huantan', false),
  ('151017', '1510', 'Huañec', false),
  ('151018', '1510', 'Laraos', false),
  ('151019', '1510', 'Lincha', false),
  ('151020', '1510', 'Madean', false),
  ('151021', '1510', 'Miraflores', false),
  ('151022', '1510', 'Omas', false),
  ('151023', '1510', 'Putinza', false),
  ('151024', '1510', 'Quinches', false),
  ('151025', '1510', 'Quinocay', false),
  ('151026', '1510', 'San Joaquin', false),
  ('151027', '1510', 'San Pedro de Pilas', false),
  ('151028', '1510', 'Tanta', false),
  ('151029', '1510', 'Tauripampa', false),
  ('151030', '1510', 'Tomas', false),
  ('151031', '1510', 'Tupe', false),
  ('151032', '1510', 'Viñac', false),
  ('151033', '1510', 'Vitis', false),
  ('160101', '1601', 'Iquitos', false),
  ('160102', '1601', 'Alto Nanay', false),
  ('160103', '1601', 'Fernando Lores', false),
  ('160104', '1601', 'Indiana', false),
  ('160105', '1601', 'Las Amazonas', false),
  ('160106', '1601', 'Mazan', false),
  ('160107', '1601', 'Napo', false),
  ('160108', '1601', 'Punchana', false),
  ('160110', '1601', 'Torres Causana', false),
  ('160112', '1601', 'Belen', false),
  ('160113', '1601', 'San Juan Bautista', false),
  ('160201', '1602', 'Yurimaguas', false),
  ('160202', '1602', 'Balsapuerto', false),
  ('160205', '1602', 'Jeberos', false),
  ('160206', '1602', 'Lagunas', false),
  ('160210', '1602', 'Santa Cruz', false),
  ('160211', '1602', 'Teniente Cesar Lopez Rojas', false),
  ('160301', '1603', 'Nauta', false),
  ('160302', '1603', 'Parinari', false),
  ('160303', '1603', 'Tigre', false),
  ('160304', '1603', 'Trompeteros', false),
  ('160305', '1603', 'Urarinas', false),
  ('160401', '1604', 'Ramon Castilla', false),
  ('160402', '1604', 'Pebas', false),
  ('160403', '1604', 'Yavari', false),
  ('160404', '1604', 'San Pablo', false),
  ('160405', '1604', 'Santa Rosa de Loreto', true),
  ('160501', '1605', 'Requena', false),
  ('160502', '1605', 'Alto Tapiche', false),
  ('160503', '1605', 'Capelo', false),
  ('160504', '1605', 'Emilio San Martin', false),
  ('160505', '1605', 'Maquia', false),
  ('160506', '1605', 'Puinahua', false),
  ('160507', '1605', 'Saquena', false),
  ('160508', '1605', 'Soplin', false),
  ('160509', '1605', 'Tapiche', false),
  ('160510', '1605', 'Jenaro Herrera', false),
  ('160511', '1605', 'Yaquerana', false),
  ('160601', '1606', 'Contamana', false),
  ('160602', '1606', 'Inahuaya', false),
  ('160603', '1606', 'Padre Marquez', false),
  ('160604', '1606', 'Pampa Hermosa', false),
  ('160605', '1606', 'Sarayacu', false),
  ('160606', '1606', 'Vargas Guerra', false),
  ('160701', '1607', 'Barranca', false),
  ('160702', '1607', 'Cahuapanas', false),
  ('160703', '1607', 'Manseriche', false),
  ('160704', '1607', 'Morona', false),
  ('160705', '1607', 'Pastaza', false),
  ('160706', '1607', 'Andoas', false),
  ('160801', '1608', 'Putumayo', false),
  ('160802', '1608', 'Rosa Panduro', false),
  ('160803', '1608', 'Teniente Manuel Clavero', false),
  ('160804', '1608', 'Yaguas', false),
  ('170101', '1701', 'Tambopata', false),
  ('170102', '1701', 'Inambari', false),
  ('170103', '1701', 'Las Piedras', false),
  ('170104', '1701', 'Laberinto', false),
  ('170201', '1702', 'Manu', false),
  ('170202', '1702', 'Fitzcarrald', false),
  ('170203', '1702', 'Madre de Dios', false),
  ('170204', '1702', 'Huepetuhe', false),
  ('170301', '1703', 'Iñapari', false),
  ('170302', '1703', 'Iberia', false),
  ('170303', '1703', 'Tahuamanu', false),
  ('180101', '1801', 'Moquegua', false),
  ('180102', '1801', 'Carumas', false),
  ('180103', '1801', 'Cuchumbaya', false),
  ('180104', '1801', 'Samegua', false),
  ('180105', '1801', 'San Cristobal', false),
  ('180106', '1801', 'Torata', false),
  ('180107', '1801', 'San Antonio', false),
  ('180201', '1802', 'Omate', false),
  ('180202', '1802', 'Chojata', false),
  ('180203', '1802', 'Coalaque', false),
  ('180204', '1802', 'Ichuña', false),
  ('180205', '1802', 'La Capilla', false),
  ('180206', '1802', 'Lloque', false),
  ('180207', '1802', 'Matalaque', false),
  ('180208', '1802', 'Puquina', false),
  ('180209', '1802', 'Quinistaquillas', false),
  ('180210', '1802', 'Ubinas', false),
  ('180211', '1802', 'Yunga', false),
  ('180301', '1803', 'Ilo', false),
  ('180302', '1803', 'El Algarrobal', false),
  ('180303', '1803', 'Pacocha', false),
  ('190101', '1901', 'Chaupimarca', false),
  ('190102', '1901', 'Huachon', false),
  ('190103', '1901', 'Huariaca', false),
  ('190104', '1901', 'Huayllay', false),
  ('190105', '1901', 'Ninacaca', false),
  ('190106', '1901', 'Pallanchacra', false),
  ('190107', '1901', 'Paucartambo', false),
  ('190108', '1901', 'San Francisco de Asis de Yarusyacan', false),
  ('190109', '1901', 'Simon Bolivar', false),
  ('190110', '1901', 'Ticlacayan', false),
  ('190111', '1901', 'Tinyahuarco', false),
  ('190112', '1901', 'Vicco', false),
  ('190113', '1901', 'Yanacancha', false),
  ('190201', '1902', 'Yanahuanca', false),
  ('190202', '1902', 'Chacayan', false),
  ('190203', '1902', 'Goyllarisquizga', false),
  ('190204', '1902', 'Paucar', false),
  ('190205', '1902', 'San Pedro de Pillao', false),
  ('190206', '1902', 'Santa Ana de Tusi', false),
  ('190207', '1902', 'Tapuc', false),
  ('190208', '1902', 'Vilcabamba', false),
  ('190301', '1903', 'Oxapampa', false),
  ('190302', '1903', 'Chontabamba', false),
  ('190303', '1903', 'Huancabamba', false),
  ('190304', '1903', 'Palcazu', false),
  ('190305', '1903', 'Pozuzo', false),
  ('190306', '1903', 'Puerto Bermudez', false),
  ('190307', '1903', 'Villa Rica', false),
  ('190308', '1903', 'Constitucion', false),
  ('200101', '2001', 'Piura', false),
  ('200104', '2001', 'Castilla', false),
  ('200105', '2001', 'Catacaos', false),
  ('200107', '2001', 'Cura Mori', false),
  ('200108', '2001', 'El Tallan', false),
  ('200109', '2001', 'La Arena', false),
  ('200110', '2001', 'La Union', false),
  ('200111', '2001', 'Las Lomas', false),
  ('200114', '2001', 'Tambo Grande', false),
  ('200115', '2001', 'Veintiseis de Octubre', false),
  ('200201', '2002', 'Ayabaca', false),
  ('200202', '2002', 'Frias', false),
  ('200203', '2002', 'Jilili', false),
  ('200204', '2002', 'Lagunas', false),
  ('200205', '2002', 'Montero', false),
  ('200206', '2002', 'Pacaipampa', false),
  ('200207', '2002', 'Paimas', false),
  ('200208', '2002', 'Sapillica', false),
  ('200209', '2002', 'Sicchez', false),
  ('200210', '2002', 'Suyo', false),
  ('200301', '2003', 'Huancabamba', false),
  ('200302', '2003', 'Canchaque', false),
  ('200303', '2003', 'El Carmen de la Frontera', false),
  ('200304', '2003', 'Huarmaca', false),
  ('200305', '2003', 'Lalaquiz', false),
  ('200306', '2003', 'San Miguel de el Faique', false),
  ('200307', '2003', 'Sondor', false),
  ('200308', '2003', 'Sondorillo', false),
  ('200401', '2004', 'Chulucanas', false),
  ('200402', '2004', 'Buenos Aires', false),
  ('200403', '2004', 'Chalaco', false),
  ('200404', '2004', 'La Matanza', false),
  ('200405', '2004', 'Morropon', false),
  ('200406', '2004', 'Salitral', false),
  ('200407', '2004', 'San Juan de Bigote', false),
  ('200408', '2004', 'Santa Catalina de Mossa', false),
  ('200409', '2004', 'Santo Domingo', false),
  ('200410', '2004', 'Yamango', false),
  ('200501', '2005', 'Paita', false),
  ('200502', '2005', 'Amotape', false),
  ('200503', '2005', 'Arenal', false),
  ('200504', '2005', 'Colan', false),
  ('200505', '2005', 'La Huaca', false),
  ('200506', '2005', 'Tamarindo', false),
  ('200507', '2005', 'Vichayal', false),
  ('200601', '2006', 'Sullana', false),
  ('200602', '2006', 'Bellavista', false),
  ('200603', '2006', 'Ignacio Escudero', false),
  ('200604', '2006', 'Lancones', false),
  ('200605', '2006', 'Marcavelica', false),
  ('200606', '2006', 'Miguel Checa', false),
  ('200607', '2006', 'Querecotillo', false),
  ('200608', '2006', 'Salitral', false),
  ('200701', '2007', 'Pariñas', false),
  ('200702', '2007', 'El Alto', false),
  ('200703', '2007', 'La Brea', false),
  ('200704', '2007', 'Lobitos', false),
  ('200705', '2007', 'Los Organos', false),
  ('200706', '2007', 'Mancora', false),
  ('200801', '2008', 'Sechura', false),
  ('200802', '2008', 'Bellavista de la Union', false),
  ('200803', '2008', 'Bernal', false),
  ('200804', '2008', 'Cristo Nos Valga', false),
  ('200805', '2008', 'Vice', false),
  ('200806', '2008', 'Rinconada Llicuar', false),
  ('210101', '2101', 'Puno', false),
  ('210102', '2101', 'Acora', false),
  ('210103', '2101', 'Amantani', false),
  ('210104', '2101', 'Atuncolla', false),
  ('210105', '2101', 'Capachica', false),
  ('210106', '2101', 'Chucuito', false),
  ('210107', '2101', 'Coata', false),
  ('210108', '2101', 'Huata', false),
  ('210109', '2101', 'Mañazo', false),
  ('210110', '2101', 'Paucarcolla', false),
  ('210111', '2101', 'Pichacani', false),
  ('210112', '2101', 'Plateria', false),
  ('210113', '2101', 'San Antonio', false),
  ('210114', '2101', 'Tiquillaca', false),
  ('210115', '2101', 'Vilque', false),
  ('210201', '2102', 'Azangaro', false),
  ('210202', '2102', 'Achaya', false),
  ('210203', '2102', 'Arapa', false),
  ('210204', '2102', 'Asillo', false),
  ('210205', '2102', 'Caminaca', false),
  ('210206', '2102', 'Chupa', false),
  ('210207', '2102', 'Jose Domingo Choquehuanca', false),
  ('210208', '2102', 'Muñani', false),
  ('210209', '2102', 'Potoni', false),
  ('210210', '2102', 'Saman', false),
  ('210211', '2102', 'San Anton', false),
  ('210212', '2102', 'San Jose', false),
  ('210213', '2102', 'San Juan de Salinas', false),
  ('210214', '2102', 'Santiago de Pupuja', false),
  ('210215', '2102', 'Tirapata', false),
  ('210301', '2103', 'Macusani', false),
  ('210302', '2103', 'Ajoyani', false),
  ('210303', '2103', 'Ayapata', false),
  ('210304', '2103', 'Coasa', false),
  ('210305', '2103', 'Corani', false),
  ('210306', '2103', 'Crucero', false),
  ('210307', '2103', 'Ituata', false),
  ('210308', '2103', 'Ollachea', false),
  ('210309', '2103', 'San Gaban', false),
  ('210310', '2103', 'Usicayos', false),
  ('210401', '2104', 'Juli', false),
  ('210402', '2104', 'Desaguadero', false),
  ('210403', '2104', 'Huacullani', false),
  ('210404', '2104', 'Kelluyo', false),
  ('210405', '2104', 'Pisacoma', false),
  ('210406', '2104', 'Pomata', false),
  ('210407', '2104', 'Zepita', false),
  ('210501', '2105', 'Ilave', false),
  ('210502', '2105', 'Capazo', false),
  ('210503', '2105', 'Pilcuyo', false),
  ('210504', '2105', 'Santa Rosa', false),
  ('210505', '2105', 'Conduriri', false),
  ('210601', '2106', 'Huancane', false),
  ('210602', '2106', 'Cojata', false),
  ('210603', '2106', 'Huatasani', false),
  ('210604', '2106', 'Inchupalla', false),
  ('210605', '2106', 'Pusi', false),
  ('210606', '2106', 'Rosaspata', false),
  ('210607', '2106', 'Taraco', false),
  ('210608', '2106', 'Vilque Chico', false),
  ('210701', '2107', 'Lampa', false),
  ('210702', '2107', 'Cabanilla', false),
  ('210703', '2107', 'Calapuja', false),
  ('210704', '2107', 'Nicasio', false),
  ('210705', '2107', 'Ocuviri', false),
  ('210706', '2107', 'Palca', false),
  ('210707', '2107', 'Paratia', false),
  ('210708', '2107', 'Pucara', false),
  ('210709', '2107', 'Santa Lucia', false),
  ('210710', '2107', 'Vilavila', false),
  ('210801', '2108', 'Ayaviri', false),
  ('210802', '2108', 'Antauta', false),
  ('210803', '2108', 'Cupi', false),
  ('210804', '2108', 'Llalli', false),
  ('210805', '2108', 'Macari', false),
  ('210806', '2108', 'Nuñoa', false),
  ('210807', '2108', 'Orurillo', false),
  ('210808', '2108', 'Santa Rosa', false),
  ('210809', '2108', 'Umachiri', false),
  ('210901', '2109', 'Moho', false),
  ('210902', '2109', 'Conima', false),
  ('210903', '2109', 'Huayrapata', false),
  ('210904', '2109', 'Tilali', false),
  ('211001', '2110', 'Putina', false),
  ('211002', '2110', 'Ananea', false),
  ('211003', '2110', 'Pedro Vilca Apaza', false),
  ('211004', '2110', 'Quilcapuncu', false),
  ('211005', '2110', 'Sina', false),
  ('211101', '2111', 'Juliaca', false),
  ('211102', '2111', 'Cabana', false),
  ('211103', '2111', 'Cabanillas', false),
  ('211104', '2111', 'Caracoto', false),
  ('211105', '2111', 'San Miguel', false),
  ('211201', '2112', 'Sandia', false),
  ('211202', '2112', 'Cuyocuyo', false),
  ('211203', '2112', 'Limbani', false),
  ('211204', '2112', 'Patambuco', false),
  ('211205', '2112', 'Phara', false),
  ('211206', '2112', 'Quiaca', false),
  ('211207', '2112', 'San Juan del Oro', false),
  ('211208', '2112', 'Yanahuaya', false),
  ('211209', '2112', 'Alto Inambari', false),
  ('211210', '2112', 'San Pedro de Putina Punco', false),
  ('211301', '2113', 'Yunguyo', false),
  ('211302', '2113', 'Anapia', false),
  ('211303', '2113', 'Copani', false),
  ('211304', '2113', 'Cuturapi', false),
  ('211305', '2113', 'Ollaraya', false),
  ('211306', '2113', 'Tinicachi', false),
  ('211307', '2113', 'Unicachi', false),
  ('220101', '2201', 'Moyobamba', false),
  ('220102', '2201', 'Calzada', false),
  ('220103', '2201', 'Habana', false),
  ('220104', '2201', 'Jepelacio', false),
  ('220105', '2201', 'Soritor', false),
  ('220106', '2201', 'Yantalo', false),
  ('220201', '2202', 'Bellavista', false),
  ('220202', '2202', 'Alto Biavo', false),
  ('220203', '2202', 'Bajo Biavo', false),
  ('220204', '2202', 'Huallaga', false),
  ('220205', '2202', 'San Pablo', false),
  ('220206', '2202', 'San Rafael', false),
  ('220301', '2203', 'San Jose de Sisa', false),
  ('220302', '2203', 'Agua Blanca', false),
  ('220303', '2203', 'San Martin', false),
  ('220304', '2203', 'Santa Rosa', false),
  ('220305', '2203', 'Shatoja', false),
  ('220401', '2204', 'Saposoa', false),
  ('220402', '2204', 'Alto Saposoa', false),
  ('220403', '2204', 'El Eslabon', false),
  ('220404', '2204', 'Piscoyacu', false),
  ('220405', '2204', 'Sacanche', false),
  ('220406', '2204', 'Tingo de Saposoa', false),
  ('220501', '2205', 'Lamas', false),
  ('220502', '2205', 'Alonso de Alvarado', false),
  ('220503', '2205', 'Barranquita', false),
  ('220504', '2205', 'Caynarachi', false),
  ('220505', '2205', 'Cuñumbuqui', false),
  ('220506', '2205', 'Pinto Recodo', false),
  ('220507', '2205', 'Rumisapa', false),
  ('220508', '2205', 'San Roque de Cumbaza', false),
  ('220509', '2205', 'Shanao', false),
  ('220510', '2205', 'Tabalosos', false),
  ('220511', '2205', 'Zapatero', false),
  ('220601', '2206', 'Juanjui', false),
  ('220602', '2206', 'Campanilla', false),
  ('220603', '2206', 'Huicungo', false),
  ('220604', '2206', 'Pachiza', false),
  ('220605', '2206', 'Pajarillo', false),
  ('220701', '2207', 'Picota', false),
  ('220702', '2207', 'Buenos Aires', false),
  ('220703', '2207', 'Caspisapa', false),
  ('220704', '2207', 'Pilluana', false),
  ('220705', '2207', 'Pucacaca', false),
  ('220706', '2207', 'San Cristobal', false),
  ('220707', '2207', 'San Hilarion', false),
  ('220708', '2207', 'Shamboyacu', false),
  ('220709', '2207', 'Tingo de Ponasa', false),
  ('220710', '2207', 'Tres Unidos', false),
  ('220801', '2208', 'Rioja', false),
  ('220802', '2208', 'Awajun', false),
  ('220803', '2208', 'Elias Soplin Vargas', false),
  ('220804', '2208', 'Nueva Cajamarca', false),
  ('220805', '2208', 'Pardo Miguel', false),
  ('220806', '2208', 'Posic', false),
  ('220807', '2208', 'San Fernando', false),
  ('220808', '2208', 'Yorongos', false),
  ('220809', '2208', 'Yuracyacu', false),
  ('220901', '2209', 'Tarapoto', false),
  ('220902', '2209', 'Alberto Leveau', false),
  ('220903', '2209', 'Cacatachi', false),
  ('220904', '2209', 'Chazuta', false),
  ('220905', '2209', 'Chipurana', false),
  ('220906', '2209', 'El Porvenir', false),
  ('220907', '2209', 'Huimbayoc', false),
  ('220908', '2209', 'Juan Guerra', false),
  ('220909', '2209', 'La Banda de Shilcayo', false),
  ('220910', '2209', 'Morales', false),
  ('220911', '2209', 'Papaplaya', false),
  ('220912', '2209', 'San Antonio', false),
  ('220913', '2209', 'Sauce', false),
  ('220914', '2209', 'Shapaja', false),
  ('221001', '2210', 'Tocache', false),
  ('221002', '2210', 'Nuevo Progreso', false),
  ('221003', '2210', 'Polvora', false),
  ('221004', '2210', 'Shunte', false),
  ('221005', '2210', 'Uchiza', false),
  ('221006', '2210', 'Santa Lucia', false),
  ('230101', '2301', 'Tacna', false),
  ('230102', '2301', 'Alto de la Alianza', false),
  ('230103', '2301', 'Calana', false),
  ('230104', '2301', 'Ciudad Nueva', false),
  ('230105', '2301', 'Inclan', false),
  ('230106', '2301', 'Pachia', false),
  ('230107', '2301', 'Palca', false),
  ('230108', '2301', 'Pocollay', false),
  ('230109', '2301', 'Sama', false),
  ('230110', '2301', 'Coronel Gregorio Albarracin Lanchipa', false),
  ('230111', '2301', 'La Yarada los Palos', false),
  ('230201', '2302', 'Candarave', false),
  ('230202', '2302', 'Cairani', false),
  ('230203', '2302', 'Camilaca', false),
  ('230204', '2302', 'Curibaya', false),
  ('230205', '2302', 'Huanuara', false),
  ('230206', '2302', 'Quilahuani', false),
  ('230301', '2303', 'Locumba', false),
  ('230302', '2303', 'Ilabaya', false),
  ('230303', '2303', 'Ite', false),
  ('230401', '2304', 'Tarata', false),
  ('230402', '2304', 'Heroes Albarracin', false),
  ('230403', '2304', 'Estique', false),
  ('230404', '2304', 'Estique-Pampa', false),
  ('230405', '2304', 'Sitajara', false),
  ('230406', '2304', 'Susapaya', false),
  ('230407', '2304', 'Tarucachi', false),
  ('230408', '2304', 'Ticaco', false),
  ('240101', '2401', 'Tumbes', false),
  ('240102', '2401', 'Corrales', false),
  ('240103', '2401', 'La Cruz', false),
  ('240104', '2401', 'Pampas de Hospital', false),
  ('240105', '2401', 'San Jacinto', false),
  ('240106', '2401', 'San Juan de la Virgen', false),
  ('240201', '2402', 'Zorritos', false),
  ('240202', '2402', 'Casitas', false),
  ('240203', '2402', 'Canoas de Punta Sal', false),
  ('240301', '2403', 'Zarumilla', false),
  ('240302', '2403', 'Aguas Verdes', false),
  ('240303', '2403', 'Matapalo', false),
  ('240304', '2403', 'Papayal', false),
  ('250101', '2501', 'Calleria', false),
  ('250102', '2501', 'Campoverde', false),
  ('250103', '2501', 'Iparia', false),
  ('250104', '2501', 'Masisea', false),
  ('250105', '2501', 'Yarinacocha', false),
  ('250106', '2501', 'Nueva Requena', false),
  ('250107', '2501', 'Manantay', false),
  ('250201', '2502', 'Raimondi', false),
  ('250202', '2502', 'Sepahua', false),
  ('250203', '2502', 'Tahuania', false),
  ('250204', '2502', 'Yurua', false),
  ('250301', '2503', 'Padre Abad', false),
  ('250302', '2503', 'Irazola', false),
  ('250303', '2503', 'Curimana', false),
  ('250304', '2503', 'Neshuya', false),
  ('250305', '2503', 'Alexander Von Humboldt', false),
  ('250306', '2503', 'Huipoca', false),
  ('250307', '2503', 'Boqueron', false),
  ('250401', '2504', 'Purus', false)
on conflict (code) do update set
  name = excluded.name, province_code = excluded.province_code, is_provisional = excluded.is_provisional;

-- >>> supabase/migrations/20261008000600_customer_stats.sql
-- =====================================================================
-- Vendia — Estadísticas por cliente (CRM básico)
-- security_invoker: la vista respeta el RLS de customers/orders.
-- =====================================================================

create view public.customer_stats
with (security_invoker = true)
as
select
  c.id,
  c.store_id,
  c.first_name,
  c.last_name,
  c.phone,
  c.whatsapp,
  c.dni,
  c.address,
  c.reference,
  c.district_code,
  dist.name as district_name,
  prov.name as province_name,
  dep.name as department_name,
  c.created_at,
  count(o.id)::int as orders_count,
  (count(o.id) filter (where o.delivered_at is not null and o.status not in ('failed_delivery', 'returned')))::int as delivered_count,
  (count(o.id) filter (where o.status = 'cancelled'))::int as cancelled_count,
  (count(o.id) filter (where o.status in ('failed_delivery', 'returned')))::int as failed_count,
  coalesce(sum(o.total) filter (where o.delivered_at is not null and o.status not in ('failed_delivery', 'returned')), 0)::numeric(12, 2) as revenue,
  max(o.created_at) as last_order_at
from public.customers c
left join public.orders o on o.customer_id = c.id
left join public.ubigeo_districts dist on dist.code = c.district_code
left join public.ubigeo_provinces prov on prov.code = dist.province_code
left join public.ubigeo_departments dep on dep.code = prov.department_code
group by c.id, dist.name, prov.name, dep.name;

revoke all on public.customer_stats from anon, authenticated;
grant select on public.customer_stats to authenticated;
