-- =====================================================================
-- Vendia — Panel de administración de la plataforma
-- Todas las funciones verifican is_platform_admin(); un vendedor normal recibe error.
-- Para nombrar un admin: npx tsx scripts/make-admin.ts tu@correo.com
-- =====================================================================

create or replace function public.admin_overview()
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
  return jsonb_build_object(
    'users', (select count(*) from auth.users),
    'stores', (select count(*) from public.stores),
    'stores_blocked', (select count(*) from public.stores where status = 'blocked'),
    'orders', (select count(*) from public.orders),
    'orders_30d', (select count(*) from public.orders where created_at > now() - interval '30 days'),
    'delivered', (select count(*) from public.orders where delivered_at is not null and status not in ('failed_delivery', 'returned')),
    'revenue', (select coalesce(sum(total), 0) from public.orders where delivered_at is not null and status not in ('failed_delivery', 'returned')),
    'landings_published', (select count(*) from public.landing_pages where status = 'published'),
    'meta_events_failed', (select count(*) from public.marketing_events where status = 'failed'),
    'integration_errors_7d', (select count(*) from public.integration_logs where not success and created_at > now() - interval '7 days')
  );
end;
$$;

create or replace function public.admin_list_stores()
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
    select jsonb_agg(jsonb_build_object(
      'id', s.id,
      'name', s.name,
      'slug', s.slug,
      'status', s.status,
      'created_at', s.created_at,
      'owner_email', u.email,
      'orders', (select count(*) from public.orders o where o.store_id = s.id),
      'delivered', (select count(*) from public.orders o where o.store_id = s.id and o.delivered_at is not null and o.status not in ('failed_delivery', 'returned')),
      'landings', (select count(*) from public.landing_pages l where l.store_id = s.id and l.status = 'published'),
      'last_order_at', (select max(o.created_at) from public.orders o where o.store_id = s.id)
    ) order by s.created_at desc)
    from public.stores s
    left join auth.users u on u.id = s.owner_id
  ), '[]'::jsonb);
end;
$$;

create or replace function public.admin_list_users()
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
    select jsonb_agg(jsonb_build_object(
      'id', u.id,
      'email', u.email,
      'created_at', u.created_at,
      'last_sign_in_at', u.last_sign_in_at,
      'store', (select s.name from public.stores s where s.owner_id = u.id limit 1),
      'is_admin', exists (select 1 from public.platform_admins a where a.user_id = u.id)
    ) order by u.created_at desc)
    from auth.users u
  ), '[]'::jsonb);
end;
$$;

create or replace function public.admin_recent_orders(p_limit integer default 50)
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
    select jsonb_agg(row_to_json(r)::jsonb)
    from (
      select o.id, o.order_number, o.created_at, o.status, o.total, o.district_name, s.name as store_name
      from public.orders o join public.stores s on s.id = o.store_id
      order by o.created_at desc
      limit least(greatest(p_limit, 1), 200)
    ) r
  ), '[]'::jsonb);
end;
$$;

create or replace function public.admin_recent_errors()
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
  return jsonb_build_object(
    'marketing', coalesce((
      select jsonb_agg(row_to_json(r)::jsonb) from (
        select m.created_at, s.name as store_name, m.event_name, m.event_id, m.attempts, m.last_error
        from public.marketing_events m join public.stores s on s.id = m.store_id
        where m.status = 'failed' order by m.created_at desc limit 50
      ) r), '[]'::jsonb),
    'integrations', coalesce((
      select jsonb_agg(row_to_json(r)::jsonb) from (
        select l.created_at, s.name as store_name, l.provider, l.operation, l.status_code, l.message
        from public.integration_logs l left join public.stores s on s.id = l.store_id
        where not l.success order by l.created_at desc limit 50
      ) r), '[]'::jsonb),
    'webhooks', coalesce((
      select jsonb_agg(row_to_json(r)::jsonb) from (
        select w.created_at, s.name as store_name, w.provider, w.external_event_id, w.signature_valid, w.error
        from public.webhook_events w left join public.stores s on s.id = w.store_id
        where w.error is not null or not w.signature_valid order by w.created_at desc limit 50
      ) r), '[]'::jsonb)
  );
end;
$$;

create or replace function public.admin_set_store_status(p_store_id uuid, p_status public.store_status)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Solo administradores' using errcode = '42501';
  end if;
  update public.stores set status = p_status where id = p_store_id;
end;
$$;

revoke all on function public.admin_overview() from public, anon;
revoke all on function public.admin_list_stores() from public, anon;
revoke all on function public.admin_list_users() from public, anon;
revoke all on function public.admin_recent_orders(integer) from public, anon;
revoke all on function public.admin_recent_errors() from public, anon;
revoke all on function public.admin_set_store_status(uuid, public.store_status) from public, anon;
grant execute on function public.admin_overview() to authenticated;
grant execute on function public.admin_list_stores() to authenticated;
grant execute on function public.admin_list_users() to authenticated;
grant execute on function public.admin_recent_orders(integer) to authenticated;
grant execute on function public.admin_recent_errors() to authenticated;
grant execute on function public.admin_set_store_status(uuid, public.store_status) to authenticated;
