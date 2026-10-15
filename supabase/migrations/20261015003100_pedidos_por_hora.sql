-- =====================================================================
-- Vendia — Pedidos por hora del día (Inicio)
--  · Cuántos pedidos llegaron en cada hora (0 a 23, hora de Lima) en el rango elegido.
--  · Solo el dueño (igual que el resto de números de Inicio).
-- =====================================================================

create or replace function public.get_hourly_orders(p_store_id uuid, p_from timestamptz, p_to timestamptz)
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

  return coalesce((
    select jsonb_agg(jsonb_build_object('hour', h.hour, 'orders', h.orders) order by h.hour)
    from (
      select extract(hour from (ord.created_at at time zone 'America/Lima'))::int as hour, count(*)::int as orders
      from public.orders ord
      where ord.store_id = p_store_id and ord.created_at >= p_from and ord.created_at < p_to
      group by 1
    ) h
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.get_hourly_orders(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.get_hourly_orders(uuid, timestamptz, timestamptz) to authenticated;
