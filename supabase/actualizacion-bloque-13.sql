-- Vendia — Actualización Bloque 13: embudo del formulario, prueba A/B de precio, borrar notificaciones y nombres de anuncios desde el link
-- Pegar en Supabase → SQL Editor → New query → Run. Una sola vez.
-- Validado localmente con scripts/validate-sql.ts (PGlite + prueba de humo).

-- =====================================================================
-- Vendia — Embudo dentro del formulario y prueba A/B de precio
--  · page_events registra los pasos del formulario: nombre, celular,
--    ubicación, dirección y «comprar» (una vez por sesión y día).
--  · get_form_funnel: en qué campo se quedan los clientes.
--  · Prueba de precio (landing_pages.settings.price_test): la mitad de las visitas
--    ve el precio B; el servidor cobra ese precio (nunca el que mande el navegador).
--    Visitas y pedidos guardan su versión (A/B) y get_price_test compara resultados.
-- =====================================================================

alter table public.page_events drop constraint if exists page_events_event_name_check;
alter table public.page_events add constraint page_events_event_name_check check (event_name in (
  'page_view', 'view_content', 'initiate_checkout',
  'form_name', 'form_phone', 'form_location', 'form_address', 'form_submit'
));
alter table public.page_events add column price_variant text check (price_variant is null or price_variant in ('A', 'B'));
alter table public.order_attribution add column price_variant text check (price_variant is null or price_variant in ('A', 'B'));

-- Registro de visitas: ángulo y versión de precio
drop function if exists public.track_landing_event(uuid, text, text, text, text, text, text);
create or replace function public.track_landing_event(
  p_landing_id uuid,
  p_event text,
  p_session text,
  p_utm_source text default null,
  p_utm_campaign text default null,
  p_campaign_id text default null,
  p_angle text default null,
  p_price_variant text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_landing public.landing_pages;
begin
  select l.* into v_landing from public.landing_pages l
  join public.stores s on s.id = l.store_id
  where l.id = p_landing_id and l.status = 'published' and s.status = 'active';
  if not found then
    return;
  end if;
  insert into public.page_events (store_id, landing_page_id, product_id, event_name, session_id, utm_source, utm_campaign, campaign_id, angle, price_variant)
  values (v_landing.store_id, v_landing.id, v_landing.product_id, p_event, p_session,
          left(p_utm_source, 255), left(p_utm_campaign, 255), left(p_campaign_id, 64), nullif(left(trim(p_angle), 60), ''),
          case when p_price_variant in ('A', 'B') then p_price_variant end)
  on conflict do nothing;
end;
$$;
revoke all on function public.track_landing_event(uuid, text, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.track_landing_event(uuid, text, text, text, text, text, text, text) to service_role;

-- Embudo del formulario: visitantes únicos que llegaron a cada paso
create or replace function public.get_form_funnel(p_store_id uuid, p_from timestamptz, p_to timestamptz)
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
      'initiate_checkout', count(distinct (e.session_id, e.landing_page_id)) filter (where e.event_name = 'initiate_checkout'),
      'form_name', count(distinct (e.session_id, e.landing_page_id)) filter (where e.event_name = 'form_name'),
      'form_phone', count(distinct (e.session_id, e.landing_page_id)) filter (where e.event_name = 'form_phone'),
      'form_location', count(distinct (e.session_id, e.landing_page_id)) filter (where e.event_name = 'form_location'),
      'form_address', count(distinct (e.session_id, e.landing_page_id)) filter (where e.event_name = 'form_address'),
      'form_submit', count(distinct (e.session_id, e.landing_page_id)) filter (where e.event_name = 'form_submit'),
      'orders', (select count(*) from public.orders o where o.store_id = p_store_id and o.landing_page_id is not null
                 and o.created_at >= p_from and o.created_at < p_to)
    )
    from public.page_events e
    where e.store_id = p_store_id and e.created_at >= p_from and e.created_at < p_to
  );
end;
$$;
grant execute on function public.get_form_funnel(uuid, timestamptz, timestamptz) to authenticated;

-- Resultados de la prueba de precio de una landing (desde que empezó)
create or replace function public.get_price_test(p_landing_id uuid, p_since timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_store uuid;
  v_mode text;
begin
  select store_id into v_store from public.landing_pages where id = p_landing_id;
  if v_store is null or not public.is_store_owner(v_store) then
    raise exception 'Sin acceso' using errcode = '42501';
  end if;
  v_mode := public.store_sale_mode(v_store);
  return coalesce((
    select jsonb_agg(x order by x ->> 'variant') from (
      select jsonb_build_object(
        'variant', v.variant,
        'visits', (select count(distinct e.session_id) from public.page_events e
                   where e.landing_page_id = p_landing_id and e.event_name = 'page_view' and e.price_variant = v.variant and e.created_at >= p_since),
        'form_opens', (select count(distinct e.session_id) from public.page_events e
                       where e.landing_page_id = p_landing_id and e.event_name = 'initiate_checkout' and e.price_variant = v.variant and e.created_at >= p_since),
        'orders', count(o.id),
        'orders_value', coalesce(sum(o.total), 0),
        'confirmed', count(o.id) filter (where o.confirmed_at is not null),
        'delivered', count(o.id) filter (where public.order_is_sale(o.status, o.zone, o.delivered_at, o.collected_at, v_mode)),
        'revenue', coalesce(sum(o.total) filter (where public.order_is_sale(o.status, o.zone, o.delivered_at, o.collected_at, v_mode)), 0),
        'product_cost', coalesce(sum(o.product_cost_total) filter (where public.order_is_sale(o.status, o.zone, o.delivered_at, o.collected_at, v_mode)), 0),
        'shipping_cost', coalesce(sum(public.order_logistics_cost(o.status, o.shipped_at, o.shipping_cost, o.return_shipments, o.packaging_cost)), 0)
      ) as x
      from (values ('A'), ('B')) v(variant)
      left join public.order_attribution a on a.landing_page_id = p_landing_id and a.price_variant = v.variant
      left join public.orders o on o.id = a.order_id and o.created_at >= p_since
      group by v.variant
    ) t
  ), '[]'::jsonb);
end;
$$;
grant execute on function public.get_price_test(uuid, timestamptz) to authenticated;

-- Pedido COD con la versión de precio (precio B validado aquí)
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
      if v_price_b is not null and v_price_b > 0 and v_price_b <= 100000 then
        v_offer.price := v_price_b;
      else
        v_variant := 'A';
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

-- Landing pública con la prueba de precio activa
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

-- =====================================================================
-- Vendia — Borrar notificaciones y nombres de anuncios desde el link
--  · Cada persona puede borrar sus notificaciones (una o todas). Solo se
--    ocultan para quien las borra: el resto del equipo las sigue viendo.
--  · Rendimiento: si Meta todavía no trae el nombre de la campaña, conjunto
--    o anuncio, se usa el que viene en el link (utm_campaign, utm_term,
--    utm_content) en vez del número.
-- =====================================================================

alter table public.notification_reads add column dismissed_at timestamptz;

-- Las borradas dejan de verse (en la campana, la página y en tiempo real) solo para esa persona
drop policy if exists "notifications: miembros leen" on public.notifications;
create policy "notifications: miembros leen" on public.notifications
  for select to authenticated using (
    public.is_store_member(store_id)
    and not exists (
      select 1 from public.notification_reads r
      where r.notification_id = notifications.id and r.user_id = (select auth.uid()) and r.dismissed_at is not null
    )
  );

create or replace function public.dismiss_notifications(p_store_id uuid, p_ids uuid[] default null)
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
  if p_ids is not null and cardinality(p_ids) > 500 then
    raise exception 'Demasiadas notificaciones' using errcode = 'P0001';
  end if;
  insert into public.notification_reads (notification_id, user_id, dismissed_at)
  select n.id, (select auth.uid()), now() from public.notifications n
  where n.store_id = p_store_id and (p_ids is null or n.id = any (p_ids))
  on conflict (notification_id, user_id) do update set dismissed_at = excluded.dismissed_at;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.dismiss_notifications(uuid, uuid[]) from public, anon;
grant execute on function public.dismiss_notifications(uuid, uuid[]) to authenticated;

-- Rendimiento con nombres del link cuando Meta no los tiene
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
    ins as (
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
