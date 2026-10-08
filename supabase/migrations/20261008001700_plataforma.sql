-- =====================================================================
-- Vendia — Bloque 6: Plataforma
--  · Varias tiendas por usuario (hasta 10 propias).
--  · Dominios propios: uno por tienda o uno para todas las tiendas del usuario.
--  · TikTok listo: Pixel + Events API (bandeja de eventos compartida con Meta).
--  · Registro de errores propio (navegador y servidor) para /admin → Errores.
--  · Tutorial de bienvenida (se puede ocultar).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Varias tiendas por usuario
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
  if (select count(*) from public.stores s where s.owner_id = v_user) >= 10 then
    raise exception 'Llegaste al máximo de 10 tiendas' using errcode = 'P0001';
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

-- Tutorial de bienvenida: el dueño puede ocultarlo
alter table public.store_settings add column onboarding_dismissed boolean not null default false;
grant update (onboarding_dismissed) on public.store_settings to authenticated;

-- ---------------------------------------------------------------------
-- 2. Dominios propios
--    store_id = null → el dominio sirve TODAS las tiendas del usuario: dominio.com/{tienda}/{landing}
--    store_id = X    → el dominio es de una tienda: dominio.com/{landing}
-- ---------------------------------------------------------------------
create table public.custom_domains (
  id uuid primary key default gen_random_uuid(),
  domain text not null unique check (domain ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$' and char_length(domain) <= 253),
  owner_id uuid not null references auth.users (id) on delete cascade,
  store_id uuid references public.stores (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'active', 'error')),
  last_check_at timestamptz,
  last_error text check (last_error is null or char_length(last_error) <= 500),
  created_at timestamptz not null default now()
);
create index custom_domains_owner_idx on public.custom_domains (owner_id);

alter table public.custom_domains enable row level security;
revoke all on public.custom_domains from anon, authenticated;
grant select, delete on public.custom_domains to authenticated;
grant insert (domain, owner_id, store_id) on public.custom_domains to authenticated;
create policy "custom_domains: el dueño ve los suyos" on public.custom_domains
  for select to authenticated using (owner_id = (select auth.uid()));
create policy "custom_domains: el dueño agrega" on public.custom_domains
  for insert to authenticated with check (
    owner_id = (select auth.uid())
    and (store_id is null or exists (select 1 from public.stores s where s.id = store_id and s.owner_id = (select auth.uid())))
  );
create policy "custom_domains: el dueño elimina" on public.custom_domains
  for delete to authenticated using (owner_id = (select auth.uid()));
-- Verificación (status) la escribe el servidor tras revisar el DNS.

-- El proxy resuelve el dominio (sin sesión): solo devuelve lo necesario para enrutar
create or replace function public.resolve_custom_domain(p_domain text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'store_slug', s.slug,
    'all_stores', d.store_id is null
  )
  from public.custom_domains d
  left join public.stores s on s.id = d.store_id
  where d.domain = lower(p_domain) and d.status = 'active'
  limit 1;
$$;
grant execute on function public.resolve_custom_domain(text) to anon, authenticated;

-- Con un dominio para todas las tiendas, solo se sirven tiendas de ese mismo usuario
create or replace function public.domain_serves_store(p_domain text, p_store_slug text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.custom_domains d
    join public.stores s on s.owner_id = d.owner_id
    where d.domain = lower(p_domain) and d.status = 'active' and d.store_id is null and s.slug = lower(p_store_slug)
  );
$$;
grant execute on function public.domain_serves_store(text, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. TikTok (Pixel + Events API). El token se escribe pero nunca se lee desde el cliente.
-- ---------------------------------------------------------------------
create table public.store_tiktok_settings (
  store_id uuid primary key references public.stores (id) on delete cascade,
  pixel_code text check (pixel_code is null or pixel_code ~ '^[A-Z0-9]{10,40}$'),
  access_token_encrypted text,
  test_event_code text check (test_event_code is null or char_length(test_event_code) <= 40),
  enabled boolean not null default false,
  send_lead boolean not null default true,
  send_purchase boolean not null default true,
  updated_at timestamptz not null default now()
);
create trigger store_tiktok_settings_updated_at before update on public.store_tiktok_settings
  for each row execute function public.set_updated_at();

alter table public.store_tiktok_settings enable row level security;
revoke all on public.store_tiktok_settings from anon, authenticated;
grant select (store_id, pixel_code, test_event_code, enabled, send_lead, send_purchase, updated_at) on public.store_tiktok_settings to authenticated;
create policy "tiktok_settings: miembros leen" on public.store_tiktok_settings
  for select to authenticated using (public.is_store_member(store_id));
-- Escritura: solo el servidor (service role) tras validar al dueño.

create or replace function public.tiktok_token_configured(p_store_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_store_member(p_store_id) and exists (
    select 1 from public.store_tiktok_settings t where t.store_id = p_store_id and t.access_token_encrypted is not null
  );
$$;
grant execute on function public.tiktok_token_configured(uuid) to authenticated;

-- La bandeja de eventos ahora es para Meta y TikTok
alter table public.marketing_events drop constraint marketing_events_platform_check;
alter table public.marketing_events add constraint marketing_events_platform_check check (platform in ('meta', 'tiktok'));
alter table public.marketing_events drop constraint marketing_events_event_name_check;
alter table public.marketing_events add constraint marketing_events_event_name_check check (event_name in (
  'PageView', 'ViewContent', 'InitiateCheckout', 'Lead', 'Purchase', 'SubmitForm', 'CompletePayment', 'PlaceAnOrder'));

-- Clic de TikTok (para atribuir la conversión)
alter table public.order_attribution
  add column ttclid text check (ttclid is null or char_length(ttclid) <= 500),
  add column ttp text check (ttp is null or char_length(ttp) <= 255);

-- Landing pública: + Pixel de TikTok
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
grant execute on function public.get_public_landing(text, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. Registro de errores propio (se agrupan por huella para no llenar la tabla)
-- ---------------------------------------------------------------------
create table public.app_errors (
  id bigint generated always as identity primary key,
  fingerprint text not null unique check (char_length(fingerprint) between 8 and 128),
  source text not null check (source in ('server', 'client')),
  message text not null check (char_length(message) <= 1000),
  stack text check (stack is null or char_length(stack) <= 6000),
  path text check (path is null or char_length(path) <= 500),
  digest text check (digest is null or char_length(digest) <= 100),
  user_agent text check (user_agent is null or char_length(user_agent) <= 500),
  store_id uuid references public.stores (id) on delete set null,
  user_id uuid references auth.users (id) on delete set null,
  count integer not null default 1,
  resolved boolean not null default false,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index app_errors_recent_idx on public.app_errors (resolved, last_seen_at desc);

alter table public.app_errors enable row level security;
revoke all on public.app_errors from anon, authenticated;
-- Solo el servidor escribe; solo los administradores de Vendia leen (vía funciones)

create or replace function public.log_app_error(p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.app_errors as e (fingerprint, source, message, stack, path, digest, user_agent, store_id, user_id)
  values (
    left(p ->> 'fingerprint', 128),
    case when p ->> 'source' = 'client' then 'client' else 'server' end,
    left(coalesce(nullif(p ->> 'message', ''), 'Error sin mensaje'), 1000),
    left(p ->> 'stack', 6000),
    left(p ->> 'path', 500),
    left(p ->> 'digest', 100),
    left(p ->> 'user_agent', 500),
    nullif(p ->> 'store_id', '')::uuid,
    nullif(p ->> 'user_id', '')::uuid
  )
  on conflict (fingerprint) do update set
    count = e.count + 1,
    last_seen_at = now(),
    resolved = false,
    path = coalesce(excluded.path, e.path),
    stack = coalesce(excluded.stack, e.stack);
end;
$$;
revoke all on function public.log_app_error(jsonb) from public, anon, authenticated;
grant execute on function public.log_app_error(jsonb) to service_role;

create or replace function public.admin_app_errors(p_include_resolved boolean default false)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Solo administradores' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(row_to_json(r)::jsonb order by r.last_seen_at desc) from (
      select e.id, e.source, e.message, e.stack, e.path, e.digest, e.count, e.resolved, e.first_seen_at, e.last_seen_at, s.name as store_name
      from public.app_errors e left join public.stores s on s.id = e.store_id
      where p_include_resolved or not e.resolved
      order by e.last_seen_at desc
      limit 200
    ) r
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.admin_app_errors(boolean) from public, anon;
grant execute on function public.admin_app_errors(boolean) to authenticated;

create or replace function public.admin_resolve_error(p_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Solo administradores' using errcode = '42501';
  end if;
  update public.app_errors set resolved = true where id = p_id;
end;
$$;
revoke all on function public.admin_resolve_error(bigint) from public, anon;
grant execute on function public.admin_resolve_error(bigint) to authenticated;

-- Errores nuevos de las últimas 24 h (aviso en el panel de admin)
create or replace function public.admin_error_count()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case when public.is_platform_admin()
    then (select count(*)::integer from public.app_errors where not resolved and last_seen_at > now() - interval '24 hours')
    else 0 end;
$$;
grant execute on function public.admin_error_count() to authenticated;
