-- Bloque 20: límites contra robots en los formularios abandonados.
-- Un robot que manda celulares inventados ya no puede llenar la lista de una tienda:
--   · máximo 3 formularios abandonados por celular al día en cada tienda;
--   · máximo 1000 formularios abandonados nuevos por tienda al día.
-- Lo que ya estaba guardado (la misma sesión) se sigue actualizando normal. El pedido no se toca.

create index if not exists abandoned_created_idx on public.abandoned_checkouts (store_id, created_at desc);

create or replace function public.upsert_abandoned_checkout(p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_landing public.landing_pages;
  v_phone text := p ->> 'phone';
  v_session text := left(p ->> 'session_id', 64);
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

  -- Límites solo para filas nuevas (la misma sesión siempre puede corregir sus datos)
  if not exists (select 1 from public.abandoned_checkouts where landing_page_id = v_landing.id and session_id = v_session) then
    if (select count(*) from public.abandoned_checkouts
        where store_id = v_landing.store_id and phone = v_phone and created_at > now() - interval '1 day') >= 3 then
      return;
    end if;
    if (select count(*) from (
          select 1 from public.abandoned_checkouts
          where store_id = v_landing.store_id and created_at > now() - interval '1 day'
          limit 1000) as hoy) >= 1000 then
      return;
    end if;
  end if;

  select * into v_district from public.ubigeo_districts where code = p ->> 'district_code';
  if nullif(p ->> 'offer_id', '') is not null then
    select * into v_offer from public.product_offers where id = (p ->> 'offer_id')::uuid and product_id = v_landing.product_id;
  end if;

  insert into public.abandoned_checkouts as ac (
    store_id, landing_page_id, session_id, customer_name, phone, email,
    district_code, district_name, province_name, offer_id, offer_name, total
  ) values (
    v_landing.store_id, v_landing.id, v_session, left(nullif(trim(p ->> 'name'), ''), 160), v_phone,
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
