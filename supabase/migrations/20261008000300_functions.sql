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
