-- Vendia — Corrección Bloque 5: productos de los adicionales y del upsell
-- (el editor los guarda como productId). Pegar en Supabase → SQL Editor → Run. Una sola vez.

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

