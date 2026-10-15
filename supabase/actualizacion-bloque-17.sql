-- Vendia — Actualización Bloque 17: quitar lotes exportados y borrarlos solos a los 30 días
-- Pegar en Supabase → SQL Editor → New query → Run. Una sola vez.
-- Validado localmente con scripts/validate-sql.ts (PGlite + prueba de humo).

-- =====================================================================
-- Vendia — Lotes exportados: quitar y limpieza automática (Bloque 17)
--  · El dueño puede quitar un lote de «Lotes exportados». Los pedidos no se tocan:
--    siguen marcados como exportados (solo se pierde la opción de volver a bajar ese Excel).
--  · Los lotes de más de 30 días se borran solos (tarea diaria /api/cron/daily).
-- =====================================================================

create or replace function public.delete_export_batch(p_batch_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_store uuid;
begin
  select store_id into v_store from public.export_batches where id = p_batch_id;
  if v_store is null or not public.is_store_owner(v_store) then
    raise exception 'Lote no encontrado' using errcode = 'P0002';
  end if;
  delete from public.export_batches where id = p_batch_id;
end;
$$;
revoke all on function public.delete_export_batch(uuid) from public, anon;
grant execute on function public.delete_export_batch(uuid) to authenticated;

create or replace function public.purge_old_export_batches()
returns integer
language sql
security definer
set search_path = ''
as $$
  with borrados as (
    delete from public.export_batches where created_at < now() - interval '30 days' returning 1
  )
  select count(*)::int from borrados;
$$;
revoke all on function public.purge_old_export_batches() from public, anon, authenticated;
