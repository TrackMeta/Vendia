-- =====================================================================
-- Vendia — Meta Pixel + Conversions API
-- · Pixel ID: público (se usa en la landing).
-- · Token de CAPI: cifrado (AES-256-GCM en la app) y NUNCA legible desde el cliente.
-- · marketing_events: bandeja de salida con event_id único (deduplicación + reintentos).
-- =====================================================================

create table public.store_meta_settings (
  store_id uuid primary key references public.stores (id) on delete cascade,
  pixel_id text check (pixel_id is null or pixel_id ~ '^[0-9]{5,20}$'),
  capi_token_encrypted text,
  test_event_code text check (test_event_code is null or char_length(test_event_code) <= 40),
  enabled boolean not null default false,
  send_lead boolean not null default true,
  send_purchase boolean not null default true,
  updated_at timestamptz not null default now()
);
create trigger store_meta_settings_updated_at before update on public.store_meta_settings
  for each row execute function public.set_updated_at();

alter table public.store_meta_settings enable row level security;
revoke all on public.store_meta_settings from anon, authenticated;
-- El token se puede ESCRIBIR pero no LEER desde el cliente.
grant select (store_id, pixel_id, test_event_code, enabled, send_lead, send_purchase, updated_at)
  on public.store_meta_settings to authenticated;
grant insert (store_id, pixel_id, capi_token_encrypted, test_event_code, enabled, send_lead, send_purchase)
  on public.store_meta_settings to authenticated;
grant update (pixel_id, capi_token_encrypted, test_event_code, enabled, send_lead, send_purchase)
  on public.store_meta_settings to authenticated;

create policy "meta_settings: miembros leen" on public.store_meta_settings
  for select to authenticated using (public.is_store_member(store_id));
create policy "meta_settings: miembros crean" on public.store_meta_settings
  for insert to authenticated with check (public.is_store_member(store_id));
create policy "meta_settings: miembros editan" on public.store_meta_settings
  for update to authenticated using (public.is_store_member(store_id)) with check (public.is_store_member(store_id));

-- ¿La tienda tiene token configurado? (sin exponerlo)
create or replace function public.meta_token_configured(p_store_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_store_member(p_store_id) and exists (
    select 1 from public.store_meta_settings s
    where s.store_id = p_store_id and s.capi_token_encrypted is not null
  );
$$;
grant execute on function public.meta_token_configured(uuid) to authenticated;

create type public.marketing_event_status as enum ('pending', 'sent', 'failed', 'skipped');

create table public.marketing_events (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  order_id uuid,
  platform text not null default 'meta' check (platform in ('meta')),
  event_name text not null check (event_name in ('PageView', 'ViewContent', 'InitiateCheckout', 'Lead', 'Purchase')),
  event_id text not null check (char_length(event_id) between 3 and 100),
  event_time timestamptz not null,
  action_source text not null default 'website',
  payload jsonb not null default '{}'::jsonb,
  status public.marketing_event_status not null default 'pending',
  attempts integer not null default 0,
  last_error text,
  response jsonb,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (order_id, store_id) references public.orders (id, store_id) on delete cascade,
  -- Un mismo evento (ej: purchase_<orderId>) NUNCA se registra dos veces
  unique (store_id, platform, event_id)
);
create index marketing_events_store_idx on public.marketing_events (store_id, created_at desc);
create index marketing_events_retry_idx on public.marketing_events (status, attempts, created_at)
  where status in ('pending', 'failed');
create trigger marketing_events_updated_at before update on public.marketing_events
  for each row execute function public.set_updated_at();

alter table public.marketing_events enable row level security;
revoke all on public.marketing_events from anon, authenticated;
grant select on public.marketing_events to authenticated;
create policy "marketing_events: miembros leen" on public.marketing_events
  for select to authenticated using (public.is_store_member(store_id));
-- Inserción/actualización: solo el servidor (service role).

-- ---------------------------------------------------------------------
-- La landing pública ahora también devuelve el Pixel ID (si Meta está activo).
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
    'meta', jsonb_build_object(
      'pixel_id', case when ms.enabled then ms.pixel_id else null end
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
  left join public.store_meta_settings ms on ms.store_id = s.id
  join public.products p on p.id = l.product_id
  where s.slug = lower(p_store_slug)
    and l.slug = lower(p_slug)
    and l.status = 'published'
    and s.status = 'active'
    and p.status = 'active';
$$;
grant execute on function public.get_public_landing(text, text) to anon, authenticated;
