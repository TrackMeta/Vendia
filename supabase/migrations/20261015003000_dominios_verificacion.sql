-- =====================================================================
-- Vendia — Dominios propios: verificación de dueño, raíz y limpieza
--  · Cada dominio tiene un código propio (verify_token). Para activarlo, el
--    vendedor crea un registro TXT _vendia.<dominio> = vendia-verify=<código>.
--    Así nadie puede usar un dominio que no es suyo.
--  · El estado (status) lo sigue cambiando solo el servidor (sin permiso de update).
--  · Los dominios pendientes de más de 7 días se borran solos (tarea diaria),
--    para que nadie bloquee un dominio ajeno.
--  · resolve_custom_domain ahora también devuelve la landing principal (para «/»)
--    y avisa si www.<dominio> debe llevar al dominio sin www.
-- =====================================================================

-- Código aleatorio de 32 caracteres (gen_random_uuid no necesita pgcrypto)
alter table public.custom_domains
  add column verify_token text not null default replace(gen_random_uuid()::text, '-', '');
-- El vendedor puede leerlo (ya tiene select) pero no escribirlo (insert solo de domain, owner_id, store_id).

create index custom_domains_pending_idx on public.custom_domains (created_at) where status <> 'active';

-- El proxy resuelve el dominio (sin sesión): solo devuelve lo necesario para enrutar.
--  · store_slug / all_stores: como antes.
--  · root_store_slug / root_landing_slug: la landing publicada más reciente para «/»
--    (en un dominio «para todas», solo si el dueño tiene una sola tienda).
--  · redirect_to: www.<dominio> sin fila propia y con <dominio> activo → se lleva al dominio sin www.
create or replace function public.resolve_custom_domain(p_domain text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_domain text := lower(p_domain);
  v_row public.custom_domains;
  v_store_slug text;
  v_root_store uuid;
  v_root_store_slug text;
  v_root_landing text;
begin
  select * into v_row from public.custom_domains d where d.domain = v_domain and d.status = 'active';
  if not found then
    if v_domain like 'www.%' and exists (
      select 1 from public.custom_domains d where d.domain = substr(v_domain, 5) and d.status = 'active'
    ) then
      return jsonb_build_object('redirect_to', substr(v_domain, 5));
    end if;
    return null;
  end if;

  if v_row.store_id is not null then
    select s.slug into v_store_slug from public.stores s where s.id = v_row.store_id;
    v_root_store := v_row.store_id;
  elsif (select count(*) from public.stores s where s.owner_id = v_row.owner_id and s.status = 'active') = 1 then
    select s.id into v_root_store from public.stores s where s.owner_id = v_row.owner_id and s.status = 'active';
  end if;

  if v_root_store is not null then
    select s.slug, l.slug into v_root_store_slug, v_root_landing
    from public.landing_pages l
    join public.stores s on s.id = l.store_id
    where l.store_id = v_root_store and l.status = 'published' and s.status = 'active'
    order by l.published_at desc nulls last, l.updated_at desc
    limit 1;
  end if;

  return jsonb_build_object(
    'store_slug', v_store_slug,
    'all_stores', v_row.store_id is null,
    'root_store_slug', v_root_store_slug,
    'root_landing_slug', v_root_landing
  );
end;
$$;
revoke all on function public.resolve_custom_domain(text) from public;
grant execute on function public.resolve_custom_domain(text) to anon, authenticated;

-- Tarea diaria: borra los dominios que no se activaron en 7 días.
-- Devuelve los dominios borrados para quitarlos también de Vercel.
create or replace function public.purge_stale_domains()
returns text[]
language sql
security definer
set search_path = ''
as $$
  with borrados as (
    delete from public.custom_domains
    where status <> 'active' and created_at < now() - interval '7 days'
    returning domain
  )
  select coalesce(array_agg(domain order by domain), '{}') from borrados;
$$;
revoke all on function public.purge_stale_domains() from public, anon, authenticated;
grant execute on function public.purge_stale_domains() to service_role;
