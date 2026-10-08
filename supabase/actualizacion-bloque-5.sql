-- Vendia — Actualización Bloque 5: Landing y ventas
-- Pegar en Supabase → SQL Editor → New query → Run. Una sola vez.
-- Validado localmente con scripts/validate-sql.ts (PGlite + prueba de humo).

-- =====================================================================
-- Vendia — Bloque 5: Landing y ventas
--  · Correo opcional del cliente.
--  · Order bumps en el formulario: el precio sale de la landing PUBLICADA
--    (el navegador solo manda qué casillas marcó).
--  · Upsell en la página de gracias: se agrega al mismo pedido con un clic
--    (una vez, en los primeros 30 minutos y antes de confirmar).
--  · Formularios abandonados (con aviso de privacidad), que se marcan como
--    recuperados cuando ese celular hace un pedido.
--  · Ángulos creativos y pruebas A/B (landing_pages.settings).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Columnas
-- ---------------------------------------------------------------------
alter table public.customers
  add column email text check (email is null or (char_length(email) <= 200 and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'));
alter table public.orders
  add column customer_email text check (customer_email is null or (char_length(customer_email) <= 200 and customer_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  add column upsell_added boolean not null default false;
alter table public.order_items
  add column kind text not null default 'main' check (kind in ('main', 'bump', 'upsell'));

-- ---------------------------------------------------------------------
-- 2. Pedido desde la landing: + correo + order bumps
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
    first_name = excluded.first_name,
    last_name = coalesce(excluded.last_name, c.last_name),
    whatsapp = coalesce(excluded.whatsapp, c.whatsapp),
    dni = coalesce(excluded.dni, c.dni),
    email = coalesce(excluded.email, c.email),
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
                            'total', v_order.total, 'duplicate_submit', false,
                            'bumps', jsonb_array_length(v_bumps));
end;
$$;
revoke all on function public.create_cod_order(jsonb) from public, anon, authenticated;
grant execute on function public.create_cod_order(jsonb) to service_role;

-- ---------------------------------------------------------------------
-- 3. Upsell en la página de gracias (un clic, mismo pedido)
-- ---------------------------------------------------------------------
create or replace function public.add_order_upsell(p_order_id uuid, p_landing_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_landing public.landing_pages;
  v_up jsonb;
  v_product public.products;
  v_price numeric(12, 2);
  v_cost numeric(12, 2);
  v_name text;
begin
  select * into v_order from public.orders where id = p_order_id and landing_page_id = p_landing_id for update;
  if not found then
    raise exception 'Pedido no encontrado' using errcode = 'P0002';
  end if;
  if v_order.upsell_added then
    raise exception 'Ya agregaste esta oferta a tu pedido' using errcode = 'P0001';
  end if;
  if v_order.status not in ('new', 'pending_confirmation') or v_order.created_at < now() - interval '30 minutes' then
    raise exception 'Esta oferta ya no está disponible' using errcode = 'P0001';
  end if;

  select * into v_landing from public.landing_pages where id = p_landing_id and status = 'published';
  v_up := v_landing.published_content -> 'thank_you_upsell';
  if v_up is null or coalesce((v_up ->> 'enabled')::boolean, false) is false then
    raise exception 'Esta oferta ya no está disponible' using errcode = 'P0001';
  end if;

  v_price := greatest(coalesce((v_up ->> 'price')::numeric, 0), 0);
  v_cost := greatest(coalesce((v_up ->> 'cost')::numeric, 0), 0);
  v_name := nullif(v_up ->> 'name', '');
  if nullif(coalesce(v_up ->> 'productId', v_up ->> 'product_id'), '') is not null then
    select * into v_product from public.products
    where id = (coalesce(v_up ->> 'productId', v_up ->> 'product_id'))::uuid and store_id = v_order.store_id and status = 'active';
    if not found then
      raise exception 'Esta oferta ya no está disponible' using errcode = 'P0001';
    end if;
    v_cost := v_product.cost;
    v_name := coalesce(v_name, v_product.name);
  end if;

  insert into public.order_items (store_id, order_id, product_id, product_name, quantity, line_price, unit_cost, kind)
  values (v_order.store_id, v_order.id, v_product.id, left(coalesce(v_name, 'Oferta especial'), 160), 1, v_price, v_cost, 'upsell');

  update public.orders o set
    subtotal = o.subtotal + v_price,
    total = o.total + v_price,
    balance_due = o.balance_due + v_price,
    product_cost_total = o.product_cost_total + v_cost,
    upsell_added = true
  where o.id = v_order.id
  returning * into v_order;

  insert into public.order_status_history (store_id, order_id, from_status, to_status, source, note)
  values (v_order.store_id, v_order.id, v_order.status, v_order.status, 'system', 'El cliente agregó «' || left(coalesce(v_name, 'Oferta especial'), 100) || '» en la página de gracias');

  return jsonb_build_object('order_id', v_order.id, 'total', v_order.total, 'added', v_price);
end;
$$;
revoke all on function public.add_order_upsell(uuid, uuid) from public, anon, authenticated;
grant execute on function public.add_order_upsell(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------
-- 4. Formularios abandonados
-- ---------------------------------------------------------------------
create table public.abandoned_checkouts (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  landing_page_id uuid not null,
  session_id text not null check (char_length(session_id) between 8 and 64),
  customer_name text check (customer_name is null or char_length(customer_name) <= 160),
  phone text not null check (phone ~ '^51[0-9]{9}$'),
  email text check (email is null or char_length(email) <= 200),
  district_code char(6),
  district_name text,
  province_name text,
  offer_id uuid,
  offer_name text,
  total numeric(12, 2),
  status text not null default 'open' check (status in ('open', 'contacted', 'recovered', 'dismissed')),
  recovered_order_id uuid,
  contacted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (landing_page_id, store_id) references public.landing_pages (id, store_id) on delete cascade,
  unique (landing_page_id, session_id)
);
create index abandoned_store_idx on public.abandoned_checkouts (store_id, status, created_at desc);
create index abandoned_phone_idx on public.abandoned_checkouts (store_id, phone) where status in ('open', 'contacted');
create trigger abandoned_checkouts_updated_at before update on public.abandoned_checkouts
  for each row execute function public.set_updated_at();

alter table public.abandoned_checkouts enable row level security;
revoke all on public.abandoned_checkouts from anon, authenticated;
grant select on public.abandoned_checkouts to authenticated;
grant update (status, contacted_at) on public.abandoned_checkouts to authenticated;
create policy "abandoned: miembros leen" on public.abandoned_checkouts
  for select to authenticated using (public.is_store_member(store_id));
create policy "abandoned: miembros actualizan" on public.abandoned_checkouts
  for update to authenticated using (public.is_store_member(store_id)) with check (public.is_store_member(store_id));

-- Desde /api/abandoned (service role). No se guarda si ese celular ya pidió hace poco.
create or replace function public.upsert_abandoned_checkout(p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_landing public.landing_pages;
  v_phone text := p ->> 'phone';
  v_district public.ubigeo_districts;
  v_offer public.product_offers;
begin
  select * into v_landing from public.landing_pages where id = (p ->> 'landing_page_id')::uuid and status = 'published';
  if not found or v_phone is null or v_phone !~ '^51[0-9]{9}$' then
    return;
  end if;
  if exists (
    select 1 from public.orders o
    where o.store_id = v_landing.store_id and o.customer_phone = v_phone and o.created_at > now() - interval '2 hours'
  ) then
    return;
  end if;
  select * into v_district from public.ubigeo_districts where code = p ->> 'district_code';
  if nullif(p ->> 'offer_id', '') is not null then
    select * into v_offer from public.product_offers where id = (p ->> 'offer_id')::uuid and product_id = v_landing.product_id;
  end if;

  insert into public.abandoned_checkouts as ac (
    store_id, landing_page_id, session_id, customer_name, phone, email,
    district_code, district_name, province_name, offer_id, offer_name, total
  ) values (
    v_landing.store_id, v_landing.id, left(p ->> 'session_id', 64), left(nullif(trim(p ->> 'name'), ''), 160), v_phone,
    left(nullif(lower(trim(p ->> 'email')), ''), 200),
    v_district.code, v_district.name,
    (select pr.name from public.ubigeo_provinces pr where pr.code = v_district.province_code),
    v_offer.id, v_offer.name, v_offer.price
  )
  on conflict (landing_page_id, session_id) do update set
    customer_name = coalesce(excluded.customer_name, ac.customer_name),
    phone = excluded.phone,
    email = coalesce(excluded.email, ac.email),
    district_code = coalesce(excluded.district_code, ac.district_code),
    district_name = coalesce(excluded.district_name, ac.district_name),
    province_name = coalesce(excluded.province_name, ac.province_name),
    offer_id = coalesce(excluded.offer_id, ac.offer_id),
    offer_name = coalesce(excluded.offer_name, ac.offer_name),
    total = coalesce(excluded.total, ac.total)
  where ac.status = 'open';
end;
$$;
revoke all on function public.upsert_abandoned_checkout(jsonb) from public, anon, authenticated;
grant execute on function public.upsert_abandoned_checkout(jsonb) to service_role;

-- Cuando ese celular hace un pedido, el formulario abandonado queda «recuperado»
create or replace function public.recover_abandoned_checkouts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.abandoned_checkouts set status = 'recovered', recovered_order_id = new.id
  where store_id = new.store_id and phone = new.customer_phone and status in ('open', 'contacted');
  return null;
end;
$$;
create trigger orders_recover_abandoned after insert on public.orders
  for each row execute function public.recover_abandoned_checkouts();

-- Se guardan 30 días (datos personales: solo lo necesario)
create or replace function public.purge_abandoned_checkouts()
returns integer
language sql
security definer
set search_path = ''
as $$
  with d as (delete from public.abandoned_checkouts where created_at < now() - interval '30 days' returning 1)
  select count(*)::integer from d;
$$;
revoke all on function public.purge_abandoned_checkouts() from public, anon, authenticated;
grant execute on function public.purge_abandoned_checkouts() to service_role;

-- ---------------------------------------------------------------------
-- 5. Landing pública: + ángulo y variantes de la prueba A/B
--    settings = { angle: "...", ab: { enabled: true, variants: [{ landing_id, weight }] } }
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

-- ---------------------------------------------------------------------
-- 6. Rendimiento por ángulo creativo
--    El gasto de cada anuncio se asigna al ángulo de la landing donde cayeron
--    la mayoría de sus pedidos (un anuncio suele apuntar a una sola landing).
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
        public.order_logistics_cost(ord.status, ord.shipped_at, ord.shipping_cost, ord.return_shipments) as logistics_cost,
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
