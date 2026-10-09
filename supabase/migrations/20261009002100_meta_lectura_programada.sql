-- =====================================================================
-- Vendia — Lectura de Meta programada (cada hora, configurable por tienda)
--  · store_meta_settings.sync_every_minutes: cada cuánto se leen las cuentas.
--  · app_internal: llave secreta del reloj (la genera la base; nadie la copia a mano)
--    y la dirección de Vendia. Solo la lee el servidor (service role).
--  · pg_cron + pg_net: cada hora Supabase llama a /api/cron/meta-sync, que lee
--    solo las tiendas a las que «ya les toca». (El plan gratis de Vercel solo
--    permite tareas diarias; por eso el reloj horario vive en Supabase.)
-- =====================================================================

alter table public.store_meta_settings
  add column sync_every_minutes integer not null default 60
    check (sync_every_minutes in (60, 120, 180, 360, 720, 1440));
grant select (sync_every_minutes) on public.store_meta_settings to authenticated;

create table public.app_internal (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
alter table public.app_internal enable row level security;
revoke all on public.app_internal from anon, authenticated;
-- Sin políticas: solo el service role (servidor de Vendia) y el reloj de la base la leen

insert into public.app_internal (key, value) values
  ('cron_token', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')),
  ('site_url', 'https://vendia-theta.vercel.app')
on conflict (key) do nothing;

-- Reloj horario. Si la base no tiene pg_cron/pg_net (por ejemplo, en pruebas locales), se omite.
do $outer$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron')
     and exists (select 1 from pg_available_extensions where name = 'pg_net') then
    -- Como indica Supabase: pg_cron en pg_catalog, pg_net en extensions (sus funciones quedan en «net»)
    create extension if not exists pg_cron with schema pg_catalog;
    create extension if not exists pg_net with schema extensions;
    grant usage on schema cron to postgres;
    grant all privileges on all tables in schema cron to postgres;
    if exists (select 1 from cron.job where jobname = 'vendia-meta-sync') then
      perform cron.unschedule('vendia-meta-sync');
    end if;
    perform cron.schedule(
      'vendia-meta-sync',
      '7 * * * *',
      $job$
        select net.http_post(
          url := (select value from public.app_internal where key = 'site_url') || '/api/cron/meta-sync',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'x-cron-token', (select value from public.app_internal where key = 'cron_token')
          ),
          body := '{}'::jsonb,
          timeout_milliseconds := 60000
        );
      $job$
    );
  else
    raise notice 'pg_cron o pg_net no disponibles: se omite el reloj horario';
  end if;
end
$outer$;
