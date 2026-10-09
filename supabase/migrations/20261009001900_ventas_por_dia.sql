-- Bloque 8 (diseño): pedidos y ventas reales por día para el gráfico del Inicio.
-- Cohorte por fecha de creación del pedido (igual que el resto del Inicio), en hora de Lima.

create or replace function public.get_daily_orders(p_store_id uuid, p_from timestamptz, p_to timestamptz)
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

  return coalesce((
    select jsonb_agg(jsonb_build_object('day', d.day, 'orders', d.orders, 'sales', d.sales, 'revenue', d.revenue) order by d.day)
    from (
      select
        (ord.created_at at time zone 'America/Lima')::date as day,
        count(*) as orders,
        count(*) filter (where public.order_is_sale(ord.status, ord.zone, ord.delivered_at, ord.collected_at, v_mode)) as sales,
        coalesce(sum(ord.total) filter (where public.order_is_sale(ord.status, ord.zone, ord.delivered_at, ord.collected_at, v_mode)), 0) as revenue
      from public.orders ord
      where ord.store_id = p_store_id and ord.created_at >= p_from and ord.created_at < p_to
      group by 1
    ) d
  ), '[]'::jsonb);
end;
$$;

grant execute on function public.get_daily_orders(uuid, timestamptz, timestamptz) to authenticated;
