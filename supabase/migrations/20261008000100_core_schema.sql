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
  foreign key (product_id, store_id) references public.products (id, store_id) on delete restrict,
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

  foreign key (customer_id, store_id) references public.customers (id, store_id) on delete restrict,
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
