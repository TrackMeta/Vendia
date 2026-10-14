-- =====================================================================
-- Vendia — App de celular: avisos con la app cerrada (Bloque 16)
--  · push_devices: cada celular con la app de Vendia (un token de Firebase por fila),
--    de UNA persona, con su sonido, si suena solo con pedidos nuevos y de qué
--    tiendas no quiere avisos.
--  · Cada notificación nueva llama a /api/push/notify (pg_net). Si no hay celulares
--    registrados para esa tienda, no se llama.
--  · La URL y el token viven en app_internal (solo el servidor y la base los leen).
-- =====================================================================

create table public.push_devices (
  token text primary key check (char_length(token) between 20 and 4096),
  user_id uuid not null references auth.users (id) on delete cascade,
  platform text not null default 'android' check (platform in ('android')),
  model text check (model is null or char_length(model) <= 200),
  app_version text check (app_version is null or char_length(app_version) <= 40),
  sound text not null default 'dingdong' check (sound in ('dingdong', 'caja', 'moneda', 'campana')),
  sound_enabled boolean not null default true,
  only_orders boolean not null default false,
  muted_store_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  seen_at timestamptz not null default now()
);
create index push_devices_user_idx on public.push_devices (user_id);
alter table public.push_devices enable row level security;
revoke all on public.push_devices from anon, authenticated;
grant select, delete on public.push_devices to authenticated;
create policy "push_devices: propios" on public.push_devices
  for select to authenticated using (user_id = (select auth.uid()));
create policy "push_devices: borrar propios" on public.push_devices
  for delete to authenticated using (user_id = (select auth.uid()));

-- Registrar (o actualizar) este celular. Si el celular era de otra cuenta (celular compartido), pasa a la actual.
create or replace function public.register_push_device(
  p_token text,
  p_model text default null,
  p_app_version text default null,
  p_sound text default 'dingdong',
  p_sound_enabled boolean default true,
  p_only_orders boolean default false,
  p_muted_store_ids uuid[] default '{}'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_muted uuid[];
begin
  if v_user is null then
    raise exception 'Inicia sesión' using errcode = '42501';
  end if;
  if p_token is null or char_length(p_token) not between 20 and 4096 then
    raise exception 'Token inválido' using errcode = 'P0001';
  end if;
  -- Solo tiendas de esta persona
  select coalesce(array_agg(s), '{}') into v_muted
  from unnest(coalesce(p_muted_store_ids, '{}')) s
  where public.is_store_member(s);

  insert into public.push_devices as d (token, user_id, model, app_version, sound, sound_enabled, only_orders, muted_store_ids)
  values (p_token, v_user, left(p_model, 200), left(p_app_version, 40),
          case when p_sound in ('dingdong', 'caja', 'moneda', 'campana') then p_sound else 'dingdong' end,
          coalesce(p_sound_enabled, true), coalesce(p_only_orders, false), v_muted)
  on conflict (token) do update set
    user_id = excluded.user_id,
    model = coalesce(excluded.model, d.model),
    app_version = coalesce(excluded.app_version, d.app_version),
    sound = excluded.sound,
    sound_enabled = excluded.sound_enabled,
    only_orders = excluded.only_orders,
    muted_store_ids = excluded.muted_store_ids,
    seen_at = now();
end;
$$;
revoke all on function public.register_push_device(text, text, text, text, boolean, boolean, uuid[]) from public, anon;
grant execute on function public.register_push_device(text, text, text, text, boolean, boolean, uuid[]) to authenticated;

-- Token del aviso (lo comprueba /api/push/notify)
insert into public.app_internal (key, value) values
  ('push_token', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')),
  ('site_url', 'https://vendia-theta.vercel.app')
on conflict (key) do nothing;

-- Cada notificación nueva → aviso al celular (solo si alguien de esa tienda tiene la app)
create or replace function public.notification_push_dispatch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_token text;
begin
  if not exists (
    select 1 from public.push_devices d
    where d.user_id in (
      select m.user_id from public.store_members m where m.store_id = new.store_id
      union select s.owner_id from public.stores s where s.id = new.store_id
    )
  ) then
    return new;
  end if;
  select value into v_url from public.app_internal where key = 'site_url';
  select value into v_token from public.app_internal where key = 'push_token';
  if v_url is null or v_token is null then
    return new;
  end if;
  -- pg_net (en Supabase); si no existe (pruebas locales) no pasa nada
  execute 'select net.http_post(url := $1, headers := $2, body := $3, timeout_milliseconds := 15000)'
    using v_url || '/api/push/notify',
          jsonb_build_object('Content-Type', 'application/json', 'x-push-token', v_token),
          jsonb_build_object('notification_id', new.id);
  return new;
exception when others then
  return new; -- el aviso al celular nunca frena la notificación
end;
$$;
revoke all on function public.notification_push_dispatch() from public, anon, authenticated;

drop trigger if exists notifications_push on public.notifications;
create trigger notifications_push after insert on public.notifications
  for each row execute function public.notification_push_dispatch();
